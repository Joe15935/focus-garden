//! Study navigator persistence ("学习导航").
//!
//! Lives in its own `study.sqlite3`, next to — never inside — the garden and
//! rules databases, so a bug here cannot damage existing focus history.
//!
//! What is stored:
//! - one versioned settings document (policy, semesters, goal, catalogue),
//!   replaced only with a matching revision (compare-and-swap);
//! - append-only learning events (a correction is a new event, never an edit);
//! - review cards;
//! - task ↔ garden-session links, unique per session;
//! - plan revisions (what was shown/accepted; not learning evidence).
//!
//! Scheduling semantics live in the frontend core; this module validates shape,
//! size and identity, and owns durability: transactions, backups, restore.
use chrono::{DateTime, Datelike, Local, NaiveDate};
use rusqlite::{Connection, OpenFlags, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    time::Duration,
};

pub const SCHEMA_VERSION: i64 = 1;
pub const BACKUP_FORMAT: &str = "focus-garden-study-backup";
const MAX_DOC_BYTES: usize = 5_000_000;
const MAX_TEXT: usize = 2_000;
const DAILY_KEEP: usize = 7;
const WEEKLY_KEEP: usize = 4;
const MANUAL_KEEP: usize = 20;

#[derive(Debug, thiserror::Error)]
pub enum StudyError {
    #[error("学习数据库错误：{0}")]
    Database(#[from] rusqlite::Error),
    #[error("学习数据格式错误：{0}")]
    Serialization(#[from] serde_json::Error),
    #[error("文件操作失败：{0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Invalid(String),
    #[error("数据已在别处更新（当前版本 {current}），请刷新后再修改。")]
    Conflict { current: i64 },
}
type Result<T> = std::result::Result<T, StudyError>;

fn invalid(message: impl Into<String>) -> StudyError {
    StudyError::Invalid(message.into())
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StudyEvent {
    pub id: String,
    /// Local date the work actually happened (YYYY-MM-DD).
    pub date: String,
    /// Stable key of what was worked on, e.g. `lecture:<catalogue id>` or `2026-09-28:law-review`.
    pub task_key: String,
    /// watched | closed-recall | exercise | retest | partial | english | output
    pub kind: String,
    pub minutes: u32,
    pub source: String,
    pub self_reported: bool,
    #[serde(default)]
    pub session_id: Option<String>,
    /// When this event supersedes an earlier one, its id. The earlier row stays.
    #[serde(default)]
    pub corrects: Option<String>,
    #[serde(default)]
    pub recorded_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SessionLink {
    pub session_id: String,
    pub occurrence_id: String,
    pub date: String,
    pub task_key: String,
    pub title: String,
    pub minutes: u32,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PlanRevision {
    #[serde(default)]
    pub id: i64,
    pub date: String,
    pub input_revision: i64,
    pub status: String,
    pub reason: String,
    pub data: Value,
    #[serde(default)]
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupInfo {
    pub file_name: String,
    pub kind: String,
    pub bytes: u64,
    pub modified: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudySnapshot {
    pub schema_version: i64,
    pub revision: i64,
    pub doc: Option<Value>,
    pub updated_at: Option<String>,
    pub events: Vec<StudyEvent>,
    pub reviews: Vec<Value>,
    pub links: Vec<SessionLink>,
    pub plans: Vec<PlanRevision>,
    pub data_path: String,
    pub backup_dir: String,
}

/// Full logical export. `doc` may be null for an empty store.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudyBackup {
    pub format: String,
    pub version: i64,
    pub exported_at: String,
    pub doc: Option<Value>,
    pub events: Vec<StudyEvent>,
    pub reviews: Vec<Value>,
    pub links: Vec<SessionLink>,
    #[serde(default)]
    pub plans: Vec<PlanRevision>,
}

pub struct StudyStore {
    db: Connection,
    path: PathBuf,
    backup_dir: PathBuf,
}

fn now_text() -> String {
    Local::now().fixed_offset().to_rfc3339()
}

fn check_date(value: &str, label: &str) -> Result<()> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .ok()
        .filter(|d| d.format("%Y-%m-%d").to_string() == value)
        .map(|_| ())
        .ok_or_else(|| invalid(format!("{label}日期格式错误：{value}")))
}

fn check_text(value: &str, label: &str, required: bool) -> Result<()> {
    if required && value.trim().is_empty() {
        return Err(invalid(format!("{label}不能为空。")));
    }
    if value.chars().count() > MAX_TEXT {
        return Err(invalid(format!("{label}过长。")));
    }
    Ok(())
}

fn check_id(value: &str, label: &str) -> Result<()> {
    check_text(value, label, true)?;
    if value.len() > 200 || value.chars().any(char::is_control) {
        return Err(invalid(format!("{label}格式无效。")));
    }
    Ok(())
}

const EVENT_KINDS: [&str; 7] = [
    "watched",
    "closed-recall",
    "exercise",
    "retest",
    "partial",
    "english",
    "output",
];

pub fn validate_event(event: &StudyEvent) -> Result<()> {
    check_id(&event.id, "事件ID")?;
    check_date(&event.date, "事件")?;
    check_id(&event.task_key, "任务标识")?;
    if !EVENT_KINDS.contains(&event.kind.as_str()) {
        return Err(invalid("未知的学习记录类型。"));
    }
    if event.minutes > 600 {
        return Err(invalid("单条记录的实际分钟需在 0–600 之间。"));
    }
    check_text(&event.source, "来源", false)?;
    if let Some(id) = &event.corrects {
        check_id(id, "被更正的事件")?;
    }
    Ok(())
}

/// Shape checks for the settings document. Semantics (times, places, weeks) are
/// validated by the frontend core before it ever reaches here.
pub fn validate_doc(doc: &Value) -> Result<()> {
    let text = serde_json::to_string(doc)?;
    if text.len() > MAX_DOC_BYTES {
        return Err(invalid("学习设置超过 5 MB，请检查内容。"));
    }
    let object = doc
        .as_object()
        .ok_or_else(|| invalid("学习设置必须是对象。"))?;
    if !object.get("policy").is_some_and(Value::is_object) {
        return Err(invalid("学习设置缺少作息规则。"));
    }
    let semesters = object
        .get("semesters")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("学习设置缺少学期列表。"))?;
    let mut ids = std::collections::BTreeSet::new();
    for semester in semesters {
        let id = semester
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid("学期缺少ID。"))?;
        if !ids.insert(id.to_string()) {
            return Err(invalid("学期ID重复。"));
        }
    }
    Ok(())
}

pub fn validate_review(card: &Value) -> Result<String> {
    let id = card
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("复习卡缺少ID。"))?;
    check_id(id, "复习卡ID")?;
    let prompt = card.get("prompt").and_then(Value::as_str).unwrap_or("");
    check_text(prompt, "复习问题", true)?;
    let source = card.get("source").and_then(Value::as_str).unwrap_or("");
    check_text(source, "核对位置", true)?;
    let due = card
        .get("dueDate")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("复习卡缺少到期日。"))?;
    check_date(due, "复习到期")?;
    if !card.get("history").is_some_and(Value::is_array) {
        return Err(invalid("复习卡缺少历史记录。"));
    }
    Ok(id.to_string())
}

fn validate_link(link: &SessionLink) -> Result<()> {
    check_id(&link.session_id, "专注记录ID")?;
    check_id(&link.occurrence_id, "任务安排ID")?;
    check_date(&link.date, "任务")?;
    check_id(&link.task_key, "任务标识")?;
    check_text(&link.title, "任务标题", true)?;
    if link.minutes == 0 || link.minutes > 300 {
        return Err(invalid("任务时长需在 1–300 分钟之间。"));
    }
    Ok(())
}

pub fn validate_backup(backup: &StudyBackup) -> Result<()> {
    if backup.format != BACKUP_FORMAT {
        return Err(invalid("这不是学习导航的备份文件。"));
    }
    if backup.version != SCHEMA_VERSION {
        return Err(invalid(format!(
            "不支持的备份版本 {}；已停止导入，原数据未改动。",
            backup.version
        )));
    }
    if let Some(doc) = &backup.doc {
        validate_doc(doc)?;
    }
    let mut ids = std::collections::BTreeSet::new();
    for event in &backup.events {
        validate_event(event)?;
        if !ids.insert(event.id.as_str()) {
            return Err(invalid("备份中有重复的学习记录ID。"));
        }
    }
    let mut ids = std::collections::BTreeSet::new();
    for card in &backup.reviews {
        let id = validate_review(card)?;
        if !ids.insert(id) {
            return Err(invalid("备份中有重复的复习卡ID。"));
        }
    }
    let mut ids = std::collections::BTreeSet::new();
    for link in &backup.links {
        validate_link(link)?;
        if !ids.insert(link.session_id.as_str()) {
            return Err(invalid("备份中有重复的专注关联。"));
        }
    }
    Ok(())
}

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS study_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS study_doc (
  id INTEGER PRIMARY KEY CHECK(id=1),
  revision INTEGER NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS study_events (
  id TEXT PRIMARY KEY,
  local_date TEXT NOT NULL,
  task_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  source TEXT NOT NULL,
  self_reported INTEGER NOT NULL,
  session_id TEXT,
  corrects TEXT,
  recorded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS study_events_date ON study_events(local_date);
CREATE TABLE IF NOT EXISTS study_reviews (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS study_session_links (
  session_id TEXT PRIMARY KEY,
  occurrence_id TEXT NOT NULL,
  local_date TEXT NOT NULL,
  task_key TEXT NOT NULL,
  title TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS study_links_occurrence ON study_session_links(occurrence_id);
CREATE TABLE IF NOT EXISTS study_plan_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  local_date TEXT NOT NULL,
  input_revision INTEGER NOT NULL,
  status TEXT NOT NULL,
  reason TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL
);
";

const TABLES: [&str; 5] = [
    "study_doc",
    "study_events",
    "study_reviews",
    "study_session_links",
    "study_plan_revisions",
];

impl StudyStore {
    /// Opens (creating if needed) the store at `path`; backups go to `backup_dir`.
    /// An existing file with a newer or unknown schema is refused, never rewritten.
    pub fn open(path: impl AsRef<Path>, backup_dir: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref().to_path_buf();
        let backup_dir = backup_dir.as_ref().to_path_buf();
        let db = Connection::open(&path)?;
        db.busy_timeout(Duration::from_secs(3))?;
        db.execute_batch(
            "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;",
        )?;
        let store = Self {
            db,
            path,
            backup_dir,
        };
        store.migrate()?;
        Ok(store)
    }

    fn migrate(&self) -> Result<()> {
        let has_meta: bool = self.db.query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='study_meta'",
            [],
            |row| row.get::<_, i64>(0),
        )? > 0;
        if has_meta {
            let version: Option<String> = self
                .db
                .query_row(
                    "SELECT value FROM study_meta WHERE key='schema_version'",
                    [],
                    |row| row.get(0),
                )
                .optional()?;
            match version.as_deref().map(str::parse::<i64>) {
                Some(Ok(SCHEMA_VERSION)) => return Ok(()),
                Some(Ok(other)) => {
                    return Err(invalid(format!(
                        "学习数据版本 {other} 高于本程序支持的 {SCHEMA_VERSION}，已停止读取，文件未改动。"
                    )));
                }
                _ => {}
            }
        }
        let tx = self.db.unchecked_transaction()?;
        tx.execute_batch(SCHEMA)?;
        tx.execute(
            "INSERT INTO study_meta(key,value) VALUES('schema_version',?1)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            [SCHEMA_VERSION.to_string()],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Device-local settings that are not study data (e.g. the phone mirror folder).
    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        Ok(self
            .db
            .query_row(
                "SELECT value FROM study_meta WHERE key=?1",
                [format!("setting:{key}")],
                |row| row.get(0),
            )
            .optional()?)
    }

    pub fn set_setting(&self, key: &str, value: Option<&str>) -> Result<()> {
        check_id(key, "设置名")?;
        let key = format!("setting:{key}");
        match value {
            Some(v) => {
                check_text(v, "设置值", false)?;
                self.db.execute(
                    "INSERT INTO study_meta(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    params![key, v],
                )?;
            }
            None => {
                self.db
                    .execute("DELETE FROM study_meta WHERE key=?1", [key])?;
            }
        }
        Ok(())
    }

    pub fn revision(&self) -> Result<i64> {
        Ok(self
            .db
            .query_row("SELECT revision FROM study_doc WHERE id=1", [], |row| {
                row.get(0)
            })
            .optional()?
            .unwrap_or(0))
    }

    pub fn snapshot(&self) -> Result<StudySnapshot> {
        let doc_row: Option<(i64, String, String)> = self
            .db
            .query_row(
                "SELECT revision,data,updated_at FROM study_doc WHERE id=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?;
        let (revision, doc, updated_at) = match doc_row {
            Some((revision, data, updated)) => {
                (revision, Some(serde_json::from_str(&data)?), Some(updated))
            }
            None => (0, None, None),
        };
        Ok(StudySnapshot {
            schema_version: SCHEMA_VERSION,
            revision,
            doc,
            updated_at,
            events: self.events()?,
            reviews: self.reviews()?,
            links: self.links()?,
            plans: self.plans(60)?,
            data_path: self.path.display().to_string(),
            backup_dir: self.backup_dir.display().to_string(),
        })
    }

    fn events(&self) -> Result<Vec<StudyEvent>> {
        let mut stmt = self.db.prepare(
            "SELECT id,local_date,task_key,kind,minutes,source,self_reported,session_id,corrects,recorded_at
             FROM study_events ORDER BY recorded_at, rowid",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(StudyEvent {
                id: row.get(0)?,
                date: row.get(1)?,
                task_key: row.get(2)?,
                kind: row.get(3)?,
                minutes: row.get(4)?,
                source: row.get(5)?,
                self_reported: row.get::<_, i64>(6)? != 0,
                session_id: row.get(7)?,
                corrects: row.get(8)?,
                recorded_at: Some(row.get(9)?),
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    fn reviews(&self) -> Result<Vec<Value>> {
        let mut stmt = self
            .db
            .prepare("SELECT data FROM study_reviews ORDER BY rowid")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(serde_json::from_str(&row?)?);
        }
        Ok(out)
    }

    fn links(&self) -> Result<Vec<SessionLink>> {
        let mut stmt = self.db.prepare(
            "SELECT session_id,occurrence_id,local_date,task_key,title,minutes,created_at
             FROM study_session_links ORDER BY created_at, rowid",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(SessionLink {
                session_id: row.get(0)?,
                occurrence_id: row.get(1)?,
                date: row.get(2)?,
                task_key: row.get(3)?,
                title: row.get(4)?,
                minutes: row.get(5)?,
                created_at: row.get(6)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    fn plans(&self, limit: i64) -> Result<Vec<PlanRevision>> {
        let mut stmt = self.db.prepare(
            "SELECT id,local_date,input_revision,status,reason,data,created_at
             FROM study_plan_revisions ORDER BY id DESC LIMIT ?1",
        )?;
        let rows = stmt.query_map([limit], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
            ))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (id, date, input_revision, status, reason, data, created_at) = row?;
            out.push(PlanRevision {
                id,
                date,
                input_revision,
                status,
                reason,
                data: serde_json::from_str(&data)?,
                created_at,
            });
        }
        Ok(out)
    }

    /// Replaces the settings document only if nobody else changed it since
    /// `expected_revision`. Returns the new revision.
    pub fn save_doc(&mut self, expected_revision: i64, doc: &Value) -> Result<i64> {
        validate_doc(doc)?;
        let tx = self.db.transaction()?;
        let current: i64 = tx
            .query_row("SELECT revision FROM study_doc WHERE id=1", [], |row| {
                row.get(0)
            })
            .optional()?
            .unwrap_or(0);
        if current != expected_revision {
            return Err(StudyError::Conflict { current });
        }
        let next = current + 1;
        tx.execute(
            "INSERT INTO study_doc(id,revision,data,updated_at) VALUES(1,?1,?2,?3)
             ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,data=excluded.data,updated_at=excluded.updated_at",
            params![next, serde_json::to_string(doc)?, now_text()],
        )?;
        tx.commit()?;
        Ok(next)
    }

    /// Idempotent: the same id twice is stored once. A different payload under
    /// an existing id is refused rather than silently overwriting a fact.
    pub fn append_event(&mut self, event: &StudyEvent) -> Result<bool> {
        validate_event(event)?;
        let tx = self.db.transaction()?;
        let inserted = insert_event(&tx, event)?;
        tx.commit()?;
        Ok(inserted)
    }

    pub fn upsert_review(&mut self, card: &Value) -> Result<()> {
        let id = validate_review(card)?;
        self.db.execute(
            "INSERT INTO study_reviews(id,data,updated_at) VALUES(?1,?2,?3)
             ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at",
            params![id, serde_json::to_string(card)?, now_text()],
        )?;
        Ok(())
    }

    pub fn link_session(&mut self, link: &SessionLink) -> Result<()> {
        validate_link(link)?;
        let changed = self.db.execute(
            "INSERT INTO study_session_links(session_id,occurrence_id,local_date,task_key,title,minutes,created_at)
             VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(session_id) DO NOTHING",
            params![
                link.session_id,
                link.occurrence_id,
                link.date,
                link.task_key,
                link.title,
                link.minutes,
                link.created_at
            ],
        )?;
        if changed == 0 {
            return Err(invalid("这次专注已经关联过任务，不会重复关联。"));
        }
        Ok(())
    }

    pub fn record_plan(&mut self, plan: &PlanRevision) -> Result<i64> {
        check_date(&plan.date, "计划")?;
        check_text(&plan.status, "计划状态", true)?;
        check_text(&plan.reason, "改动理由", false)?;
        let data = serde_json::to_string(&plan.data)?;
        if data.len() > 1_000_000 {
            return Err(invalid("计划记录过大。"));
        }
        self.db.execute(
            "INSERT INTO study_plan_revisions(local_date,input_revision,status,reason,data,created_at)
             VALUES(?1,?2,?3,?4,?5,?6)",
            params![plan.date, plan.input_revision, plan.status, plan.reason, data, now_text()],
        )?;
        Ok(self.db.last_insert_rowid())
    }

    pub fn export(&self) -> Result<StudyBackup> {
        let snapshot = self.snapshot()?;
        Ok(StudyBackup {
            format: BACKUP_FORMAT.into(),
            version: SCHEMA_VERSION,
            exported_at: now_text(),
            doc: snapshot.doc,
            events: snapshot.events,
            reviews: snapshot.reviews,
            links: snapshot.links,
            plans: self.plans(i64::MAX)?,
        })
    }

    /// Validates everything, snapshots the current file, then swaps all tables
    /// in one transaction. Any failure leaves the previous data untouched.
    pub fn import(&mut self, backup: &StudyBackup, expected_revision: i64) -> Result<i64> {
        validate_backup(backup)?;
        let current = self.revision()?;
        if current != expected_revision {
            return Err(StudyError::Conflict { current });
        }
        self.backup_now("pre-import")?;
        let tx = self.db.transaction()?;
        for table in TABLES {
            tx.execute(&format!("DELETE FROM {table}"), [])?;
        }
        let next = current + 1;
        if let Some(doc) = &backup.doc {
            tx.execute(
                "INSERT INTO study_doc(id,revision,data,updated_at) VALUES(1,?1,?2,?3)",
                params![next, serde_json::to_string(doc)?, now_text()],
            )?;
        }
        for event in &backup.events {
            insert_event(&tx, event)?;
        }
        for card in &backup.reviews {
            let id = validate_review(card)?;
            tx.execute(
                "INSERT INTO study_reviews(id,data,updated_at) VALUES(?1,?2,?3)",
                params![id, serde_json::to_string(card)?, now_text()],
            )?;
        }
        for link in &backup.links {
            tx.execute(
                "INSERT INTO study_session_links(session_id,occurrence_id,local_date,task_key,title,minutes,created_at)
                 VALUES(?1,?2,?3,?4,?5,?6,?7)",
                params![link.session_id, link.occurrence_id, link.date, link.task_key, link.title, link.minutes, link.created_at],
            )?;
        }
        for plan in &backup.plans {
            tx.execute(
                "INSERT INTO study_plan_revisions(local_date,input_revision,status,reason,data,created_at)
                 VALUES(?1,?2,?3,?4,?5,?6)",
                params![plan.date, plan.input_revision, plan.status, plan.reason, serde_json::to_string(&plan.data)?, plan.created_at],
            )?;
        }
        tx.commit()?;
        Ok(if backup.doc.is_some() { next } else { 0 })
    }

    /// Consistent copy via `VACUUM INTO` (safe under WAL, unlike copying the
    /// main file). Returns the backup file name.
    pub fn backup_now(&self, kind: &str) -> Result<String> {
        if !matches!(
            kind,
            "daily" | "weekly" | "manual" | "pre-import" | "pre-restore"
        ) {
            return Err(invalid("未知备份类型。"));
        }
        std::fs::create_dir_all(&self.backup_dir)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ =
                std::fs::set_permissions(&self.backup_dir, std::fs::Permissions::from_mode(0o700));
        }
        let stamp = Local::now().format("%Y%m%d-%H%M%S%.3f");
        let name = format!("study-{kind}-{stamp}.sqlite3");
        let target = self.backup_dir.join(&name);
        if target.exists() {
            return Err(invalid("同名备份已存在，请稍后再试。"));
        }
        let target_text = target
            .to_str()
            .ok_or_else(|| invalid("备份路径包含无法处理的字符。"))?;
        self.db.execute("VACUUM INTO ?1", [target_text])?;
        self.rotate(kind)?;
        Ok(name)
    }

    /// Daily backup once per local day; weekly once per ISO week. Called at launch.
    pub fn auto_backup(&self) -> Result<Vec<String>> {
        let mut made = Vec::new();
        let backups = self.list_backups()?;
        let today = Local::now().date_naive();
        let stamp_of = |name: &str| -> Option<NaiveDate> {
            let digits = name.split('-').find(|part| part.len() == 8)?;
            NaiveDate::parse_from_str(digits, "%Y%m%d").ok()
        };
        let has = |kind: &str, same: &dyn Fn(NaiveDate) -> bool| {
            backups
                .iter()
                .filter(|b| b.kind == kind)
                .filter_map(|b| stamp_of(&b.file_name))
                .any(same)
        };
        if self.revision()? == 0 && self.snapshot()?.events.is_empty() {
            return Ok(made); // nothing worth protecting yet
        }
        if !has("daily", &|d| d == today) {
            made.push(self.backup_now("daily")?);
        }
        if !has("weekly", &|d| d.iso_week() == today.iso_week()) {
            made.push(self.backup_now("weekly")?);
        }
        Ok(made)
    }

    fn rotate(&self, kind: &str) -> Result<()> {
        let keep = match kind {
            "daily" => DAILY_KEEP,
            "weekly" => WEEKLY_KEEP,
            _ => MANUAL_KEEP,
        };
        let mut same: Vec<BackupInfo> = self
            .list_backups()?
            .into_iter()
            .filter(|b| b.kind == kind)
            .collect();
        same.sort_by(|a, b| b.file_name.cmp(&a.file_name));
        for old in same.into_iter().skip(keep) {
            std::fs::remove_file(self.backup_dir.join(old.file_name))?;
        }
        Ok(())
    }

    pub fn list_backups(&self) -> Result<Vec<BackupInfo>> {
        let mut out = Vec::new();
        let entries = match std::fs::read_dir(&self.backup_dir) {
            Ok(entries) => entries,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(out),
            Err(e) => return Err(e.into()),
        };
        for entry in entries {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().to_string();
            let Some(kind) = backup_kind(&name) else {
                continue;
            };
            let meta = entry.metadata()?;
            if !meta.is_file() {
                continue;
            }
            let modified: DateTime<Local> = meta.modified()?.into();
            out.push(BackupInfo {
                file_name: name,
                kind: kind.into(),
                bytes: meta.len(),
                modified: modified.fixed_offset().to_rfc3339(),
            });
        }
        out.sort_by(|a, b| b.file_name.cmp(&a.file_name));
        Ok(out)
    }

    /// Reads a backup file (by bare file name inside the backup folder) without
    /// modifying anything. Used by restore and by restore drills.
    pub fn read_backup(&self, file_name: &str) -> Result<StudyBackup> {
        if backup_kind(file_name).is_none()
            || file_name.contains(['/', '\\'])
            || file_name.contains("..")
        {
            return Err(invalid("只能从学习导航自己的备份文件夹恢复。"));
        }
        read_backup_file(&self.backup_dir.join(file_name))
    }

    /// Restores a native backup: integrity-checked, snapshotted first, one transaction.
    pub fn restore(&mut self, file_name: &str, expected_revision: i64) -> Result<i64> {
        let backup = self.read_backup(file_name)?;
        let current = self.revision()?;
        if current != expected_revision {
            return Err(StudyError::Conflict { current });
        }
        self.backup_now("pre-restore")?;
        // The import path takes its own pre-import snapshot too; that duplication is cheap.
        let result = self.import(&backup, current)?;
        Ok(result)
    }
}

fn backup_kind(name: &str) -> Option<&'static str> {
    let rest = name.strip_prefix("study-")?.strip_suffix(".sqlite3")?;
    ["pre-restore", "pre-import", "daily", "weekly", "manual"]
        .into_iter()
        .find(|kind| rest.starts_with(&format!("{kind}-")))
}

fn insert_event(tx: &Transaction<'_>, event: &StudyEvent) -> Result<bool> {
    validate_event(event)?;
    let existing: Option<(String, String, String, u32)> = tx
        .query_row(
            "SELECT local_date,task_key,kind,minutes FROM study_events WHERE id=?1",
            [&event.id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()?;
    if let Some((date, key, kind, minutes)) = existing {
        if date == event.date
            && key == event.task_key
            && kind == event.kind
            && minutes == event.minutes
        {
            return Ok(false);
        }
        return Err(invalid(
            "同一记录ID已有不同内容；如需更正，请新增一条更正记录。",
        ));
    }
    tx.execute(
        "INSERT INTO study_events(id,local_date,task_key,kind,minutes,source,self_reported,session_id,corrects,recorded_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        params![
            event.id,
            event.date,
            event.task_key,
            event.kind,
            event.minutes,
            event.source,
            i64::from(event.self_reported),
            event.session_id,
            event.corrects,
            event.recorded_at.clone().unwrap_or_else(now_text)
        ],
    )?;
    Ok(true)
}

/// Opens a backup read-only, checks integrity and schema, and returns its content.
pub fn read_backup_file(path: &Path) -> Result<StudyBackup> {
    let db = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    let check: String = db.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
    if check != "ok" {
        return Err(invalid("备份文件完整性检查未通过，未恢复。"));
    }
    let version: Option<String> = db
        .query_row(
            "SELECT value FROM study_meta WHERE key='schema_version'",
            [],
            |row| row.get(0),
        )
        .optional()?;
    if version.as_deref() != Some(&SCHEMA_VERSION.to_string()) {
        return Err(invalid("备份版本不受支持，未恢复。"));
    }
    // Reuse the store readers on a read-only connection.
    let store = StudyStore {
        db,
        path: path.to_path_buf(),
        backup_dir: PathBuf::new(),
    };
    let backup = StudyBackup {
        format: BACKUP_FORMAT.into(),
        version: SCHEMA_VERSION,
        exported_at: now_text(),
        doc: store.snapshot()?.doc,
        events: store.events()?,
        reviews: store.reviews()?,
        links: store.links()?,
        plans: store.plans(i64::MAX)?,
    };
    validate_backup(&backup)?;
    Ok(backup)
}

#[cfg(test)]
mod tests;
