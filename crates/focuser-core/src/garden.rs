//! Local focus accounting. Only the backend's monotonic clock earns time.
//! Missing heartbeats, sleep and wall-clock discontinuities never earn credit.
//! The database is independent of the upstream Pomodoro history.
use chrono::{DateTime, Datelike, FixedOffset, Local, NaiveDate, Timelike};
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    path::Path,
    time::{Duration, Instant},
};
use uuid::Uuid;

pub const DEEP_EXIT_CONFIRMATION: &str = "我确认提前结束本次专注";
const MAX_HEARTBEAT_GAP: Duration = Duration::from_secs(5);

#[derive(Debug, thiserror::Error)]
pub enum GardenError {
    #[error("本地数据库错误：{0}")]
    Database(#[from] rusqlite::Error),
    #[error("本地数据格式错误：{0}")]
    Serialization(#[from] serde_json::Error),
    #[error("{0}")]
    Invalid(String),
}
type Result<T> = std::result::Result<T, GardenError>;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Strict {
    Gentle,
    Focus,
    Deep,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Work,
    Break,
    Completed,
    Interrupted,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    Pending,
    Completed,
    Partial,
    Unfinished,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartRequest {
    pub list_id: String,
    pub task: String,
    pub category: String,
    pub work_secs: u32,
    pub break_secs: u32,
    pub strict: Strict,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub daily_goal_minutes: u32,
    pub weekly_goal_minutes: u32,
    pub streak_minutes: u32,
    pub theme: String,
    pub plant: String,
    pub pot: String,
    pub background: String,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            daily_goal_minutes: 120,
            weekly_goal_minutes: 600,
            streak_minutes: 30,
            theme: "system".into(),
            plant: "sprout".into(),
            pot: "clay".into(),
            background: "meadow".into(),
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub list_id: String,
    pub task: String,
    pub category: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub local_date: String,
    pub planned_secs: u32,
    pub elapsed_secs: u32,
    pub break_secs: u32,
    pub strict: Strict,
    pub status: Status,
    pub reason: Option<String>,
    pub outcome: Outcome,
    pub exit_requested_at: Option<String>,
    pub exit_remaining_secs: u32,
    pub xp: u64,
    /// Remaining break time, computed by the same safe backend heartbeat.
    pub break_remaining_secs: u32,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Day {
    pub date: String,
    pub seconds: u64,
    pub sessions: u64,
    pub tasks: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Achievement {
    pub id: String,
    pub title: String,
    pub description: String,
    pub unlocked: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snapshot {
    pub config: Config,
    pub active: Option<Session>,
    pub sessions: Vec<Session>,
    pub total_seconds: u64,
    pub total_xp: u64,
    pub level: u32,
    pub level_xp: u64,
    pub level_next_xp: u64,
    pub current_streak: u32,
    pub longest_streak: u32,
    pub achievements: Vec<Achievement>,
    pub days: Vec<Day>,
    pub app_blocks: u64,
    pub website_blocks: u64,
    pub completed_sessions: u64,
    pub interrupted_sessions: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Record {
    session: Session,
    days: BTreeMap<String, u64>,
    app_blocks: u64,
    website_blocks: u64,
    work_finished: bool,
}
#[derive(Clone)]
struct ClockSample {
    monotonic: Duration,
    wall: DateTime<FixedOffset>,
}
trait Clock: Send {
    fn now(&self) -> ClockSample;
}
struct SystemClock {
    origin: Instant,
}
impl Clock for SystemClock {
    fn now(&self) -> ClockSample {
        ClockSample {
            monotonic: self.origin.elapsed(),
            wall: Local::now().fixed_offset(),
        }
    }
}

pub struct GardenService {
    db: Connection,
    records: Vec<Record>,
    config: Config,
    clock: Box<dyn Clock>,
    last: ClockSample,
    wall_highwater: DateTime<FixedOffset>,
    carry_ms: u64,
    exit_deadline: Option<(String, Duration)>,
}
impl GardenService {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        Self::with_clock(
            Connection::open(path)?,
            Box::new(SystemClock {
                origin: Instant::now(),
            }),
        )
    }
    fn with_clock(db: Connection, clock: Box<dyn Clock>) -> Result<Self> {
        db.busy_timeout(Duration::from_secs(3))?;
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
            CREATE TABLE IF NOT EXISTS garden_config (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS garden_sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL);")?;
        let config_json = db.query_row("SELECT data FROM garden_config WHERE id=1", [], |row| {
            row.get::<_, String>(0)
        });
        let config = match config_json {
            Ok(v) => serde_json::from_str(&v)?,
            Err(rusqlite::Error::QueryReturnedNoRows) => Config::default(),
            Err(e) => return Err(e.into()),
        };
        let records = {
            let mut stmt = db.prepare("SELECT data FROM garden_sessions ORDER BY rowid")?;
            let values = stmt.query_map([], |row| row.get::<_, String>(0))?;
            let mut records = Vec::new();
            for value in values {
                records.push(serde_json::from_str(&value?)?);
            }
            records
        };
        let now = clock.now();
        let mut service = Self {
            db,
            records,
            config,
            clock,
            last: now.clone(),
            wall_highwater: now.wall,
            carry_ms: 0,
            exit_deadline: None,
        };
        service.recover_on_launch()?;
        Ok(service)
    }
    fn active_index(&self) -> Option<usize> {
        self.records
            .iter()
            .position(|r| matches!(r.session.status, Status::Work | Status::Break))
    }
    pub fn has_active_session(&self) -> bool {
        self.active_index().is_some()
    }
    pub fn active_work_list_id(&self) -> Option<String> {
        self.records
            .iter()
            .find(|r| r.session.status == Status::Work)
            .map(|r| r.session.list_id.clone())
    }
    fn save_record(&mut self, index: usize, record: Record) -> Result<()> {
        let data = serde_json::to_string(&record)?;
        self.db.execute("INSERT INTO garden_sessions(id,data) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET data=excluded.data", params![record.session.id, data])?;
        if index == self.records.len() {
            self.records.push(record);
        } else {
            self.records[index] = record;
        }
        Ok(())
    }
    /// Restarts never convert offline time into focus or completion bonuses.
    pub fn recover_on_launch(&mut self) -> Result<()> {
        let now = self.clock.now();
        for index in 0..self.records.len() {
            let mut record = self.records[index].clone();
            if !matches!(record.session.status, Status::Work | Status::Break) {
                continue;
            }
            record.session.status = if record.work_finished {
                Status::Completed
            } else {
                Status::Interrupted
            };
            record
                .session
                .ended_at
                .get_or_insert_with(|| now.wall.to_rfc3339());
            if !record.work_finished {
                record.session.reason =
                    Some("应用退出或重启，本次专注已安全结束；离线时间不计入。".into());
            }
            record.session.exit_remaining_secs = 0;
            record.session.break_remaining_secs = 0;
            self.save_record(index, record)?;
        }
        self.last = now.clone();
        self.wall_highwater = now.wall;
        self.carry_ms = 0;
        self.exit_deadline = None;
        Ok(())
    }
    pub fn start(&mut self, request: StartRequest) -> Result<Snapshot> {
        if self.active_index().is_some() {
            return Err(GardenError::Invalid("请先完成或结束当前专注。".into()));
        }
        if request.list_id.trim().is_empty() || request.list_id.len() > 256 {
            return Err(GardenError::Invalid("请选择有效的屏蔽列表。".into()));
        }
        if request.work_secs == 0 || request.work_secs > 86400 || request.break_secs > 7200 {
            return Err(GardenError::Invalid(
                "专注时间应为 1 秒至 24 小时，休息不超过 2 小时。".into(),
            ));
        }
        if request.task.chars().count() > 500 || request.category.chars().count() > 100 {
            return Err(GardenError::Invalid("任务或类别文字过长。".into()));
        }
        let now = self.clock.now();
        let record = Record {
            session: Session {
                id: Uuid::new_v4().to_string(),
                list_id: request.list_id,
                task: request.task.trim().to_owned(),
                category: request.category.trim().to_owned(),
                started_at: now.wall.to_rfc3339(),
                ended_at: None,
                local_date: now.wall.date_naive().to_string(),
                planned_secs: request.work_secs,
                elapsed_secs: 0,
                break_secs: request.break_secs,
                strict: request.strict,
                status: Status::Work,
                reason: None,
                outcome: Outcome::Pending,
                exit_requested_at: None,
                exit_remaining_secs: 0,
                xp: 0,
                break_remaining_secs: request.break_secs,
            },
            days: BTreeMap::new(),
            app_blocks: 0,
            website_blocks: 0,
            work_finished: false,
        };
        self.save_record(self.records.len(), record)?;
        self.last = now.clone();
        self.wall_highwater = now.wall;
        self.carry_ms = 0;
        self.exit_deadline = None;
        self.snapshot()
    }
    /// Call approximately once per second from the native runtime, never the UI.
    pub fn tick(&mut self) -> Result<Snapshot> {
        let now = self.clock.now();
        let mono = now.monotonic.checked_sub(self.last.monotonic);
        let wall_ms = now
            .wall
            .signed_duration_since(self.last.wall)
            .num_milliseconds();
        let previous_highwater = self.wall_highwater;
        let valid = mono.is_some_and(|d| {
            d <= MAX_HEARTBEAT_GAP && wall_ms >= 0 && (d.as_millis() as i64 - wall_ms).abs() <= 1500
        }) && self.last.wall >= previous_highwater
            && now.wall >= previous_highwater;
        self.last = now.clone();
        if now.wall > self.wall_highwater {
            self.wall_highwater = now.wall;
        }
        let Some(index) = self.active_index() else {
            self.carry_ms = 0;
            return self.snapshot();
        };
        if !valid {
            self.carry_ms = 0;
            return self.snapshot();
        }
        let elapsed_ms = mono.unwrap_or_default().as_millis() as u64;
        self.carry_ms += elapsed_ms;
        let available_seconds = self.carry_ms / 1000;
        self.carry_ms %= 1000;
        if available_seconds == 0 {
            return self.snapshot();
        }
        let mut record = self.records[index].clone();
        match record.session.status {
            Status::Work => {
                let seconds = available_seconds
                    .min((record.session.planned_secs - record.session.elapsed_secs) as u64);
                // Credit each second to the local date it was actually observed on.
                // Midpoint attribution splits a heartbeat straddling midnight fairly.
                for offset in 0..seconds {
                    let back_ms =
                        ((available_seconds - offset) * 1000).saturating_sub(500) + self.carry_ms;
                    let date = (now.wall - chrono::Duration::milliseconds(back_ms as i64))
                        .date_naive()
                        .to_string();
                    *record.days.entry(date).or_default() += 1;
                }
                record.session.elapsed_secs += seconds as u32;
                let minutes = (record.session.elapsed_secs / 60) as u64;
                record.session.xp = minutes;
                if record.session.elapsed_secs == record.session.planned_secs {
                    record.work_finished = true;
                    record.session.xp += minutes / 10;
                    record.session.ended_at = Some(now.wall.to_rfc3339());
                    record.session.exit_remaining_secs = 0;
                    record.session.status = if record.session.break_secs > 0 {
                        Status::Break
                    } else {
                        Status::Completed
                    };
                    self.exit_deadline = None;
                    self.carry_ms = 0;
                }
            }
            Status::Break => {
                record.session.break_remaining_secs = record
                    .session
                    .break_remaining_secs
                    .saturating_sub(available_seconds as u32);
                if record.session.break_remaining_secs == 0 {
                    record.session.status = Status::Completed;
                    self.carry_ms = 0;
                }
            }
            _ => {}
        }
        self.save_record(index, record)?;
        self.snapshot()
    }
    pub fn request_exit(&mut self) -> Result<Snapshot> {
        self.tick()?;
        let index = self
            .active_index()
            .ok_or_else(|| GardenError::Invalid("当前没有进行中的专注。".into()))?;
        let mut record = self.records[index].clone();
        if record.session.exit_requested_at.is_none() {
            let now = self.clock.now();
            let delay = if record.session.status == Status::Break {
                0
            } else {
                match record.session.strict {
                    Strict::Gentle => 0,
                    Strict::Focus => 30,
                    Strict::Deep => 300,
                }
            };
            record.session.exit_requested_at = Some(now.wall.to_rfc3339());
            record.session.exit_remaining_secs = delay;
            self.save_record(index, record.clone())?;
            self.exit_deadline = Some((
                record.session.id,
                now.monotonic + Duration::from_secs(delay as u64),
            ));
        }
        self.snapshot()
    }
    pub fn confirm_exit(&mut self, reason: String, confirmation: String) -> Result<Snapshot> {
        self.tick()?;
        let index = self
            .active_index()
            .ok_or_else(|| GardenError::Invalid("当前没有进行中的专注。".into()))?;
        let mut record = self.records[index].clone();
        let now = self.clock.now();
        if record.session.status == Status::Work && record.session.strict != Strict::Gentle {
            let deadline = self
                .exit_deadline
                .as_ref()
                .filter(|(id, _)| id == &record.session.id)
                .map(|(_, d)| *d)
                .ok_or_else(|| GardenError::Invalid("请先申请提前结束，等待冷静期。".into()))?;
            if now.monotonic < deadline {
                return Err(GardenError::Invalid("冷静期尚未结束，请稍等。".into()));
            }
            if reason.trim().is_empty() {
                return Err(GardenError::Invalid("请写下本次提前结束的原因。".into()));
            }
            if record.session.strict == Strict::Deep
                && confirmation.trim() != DEEP_EXIT_CONFIRMATION
            {
                return Err(GardenError::Invalid(format!(
                    "请输入：{DEEP_EXIT_CONFIRMATION}"
                )));
            }
        }
        if reason.chars().count() > 2000 {
            return Err(GardenError::Invalid(
                "提前结束原因不能超过 2000 字。".into(),
            ));
        }
        record.session.status = if record.work_finished {
            Status::Completed
        } else {
            Status::Interrupted
        };
        record
            .session
            .ended_at
            .get_or_insert_with(|| now.wall.to_rfc3339());
        if !record.work_finished {
            record.session.reason = Some(reason.trim().to_owned());
        }
        record.session.exit_remaining_secs = 0;
        record.session.break_remaining_secs = 0;
        self.save_record(index, record)?;
        self.exit_deadline = None;
        self.carry_ms = 0;
        self.snapshot()
    }
    pub fn set_outcome(&mut self, id: String, outcome: Outcome) -> Result<Snapshot> {
        let index = self
            .records
            .iter()
            .position(|r| r.session.id == id)
            .ok_or_else(|| GardenError::Invalid("没有找到这次专注。".into()))?;
        let mut record = self.records[index].clone();
        if record.session.status == Status::Work {
            return Err(GardenError::Invalid(
                "专注结束后再记录任务完成情况。".into(),
            ));
        }
        record.session.outcome = outcome;
        self.save_record(index, record)?;
        self.snapshot()
    }
    pub fn update_config(&mut self, config: Config) -> Result<Snapshot> {
        if !(1..=1440).contains(&config.daily_goal_minutes)
            || !(1..=10080).contains(&config.weekly_goal_minutes)
            || !(1..=1440).contains(&config.streak_minutes)
        {
            return Err(GardenError::Invalid(
                "每日目标和连续专注门槛需为 1–1440 分钟，每周目标需为 1–10080 分钟。".into(),
            ));
        }
        if !matches!(config.theme.as_str(), "system" | "light" | "dark") {
            return Err(GardenError::Invalid("请选择系统、浅色或深色主题。".into()));
        }
        let level = self.snapshot()?.level;
        for (value, choices) in [
            (&config.plant, ["sprout", "fern", "tree"]),
            (&config.pot, ["clay", "ceramic", "stone"]),
            (&config.background, ["meadow", "dusk", "mist"]),
        ] {
            let position = choices
                .iter()
                .position(|choice| *choice == value.as_str())
                .ok_or_else(|| GardenError::Invalid("请选择已有的花园装饰。".into()))?;
            let required = [1, 3, 6][position];
            if level < required {
                return Err(GardenError::Invalid(format!(
                    "这件装饰将在 Lv.{required} 解锁。"
                )));
            }
        }
        self.db.execute("INSERT INTO garden_config(id,data) VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET data=excluded.data", [serde_json::to_string(&config)?])?;
        self.config = config;
        self.snapshot()
    }
    /// Called only after a native blocking operation is confirmed; no UI command.
    pub fn record_block(&mut self, kind: &str) -> Result<()> {
        let Some(index) = self.active_index() else {
            return Ok(());
        };
        let mut record = self.records[index].clone();
        if record.session.status != Status::Work {
            return Ok(());
        }
        match kind {
            "app" => record.app_blocks += 1,
            "website" => record.website_blocks += 1,
            _ => return Err(GardenError::Invalid("未知拦截类型。".into())),
        }
        self.save_record(index, record)
    }
    fn session_for_snapshot(&self, record: &Record) -> Session {
        let mut session = record.session.clone();
        session.exit_remaining_secs = self
            .exit_deadline
            .as_ref()
            .filter(|(id, _)| id == &session.id)
            .map(|(_, deadline)| {
                let remaining = deadline.saturating_sub(self.clock.now().monotonic);
                remaining.as_secs() as u32 + u32::from(remaining.subsec_nanos() > 0)
            })
            .unwrap_or(0);
        session
    }
    pub fn snapshot(&self) -> Result<Snapshot> {
        let today = self.clock.now().wall.date_naive();
        let mut days: BTreeMap<String, Day> = BTreeMap::new();
        for record in &self.records {
            for (date, seconds) in &record.days {
                let day = days.entry(date.clone()).or_insert_with(|| Day {
                    date: date.clone(),
                    seconds: 0,
                    sessions: 0,
                    tasks: Vec::new(),
                });
                day.seconds += seconds;
                day.sessions += 1;
                if record.session.outcome == Outcome::Completed
                    && !record.session.task.is_empty()
                    && !day.tasks.contains(&record.session.task)
                {
                    day.tasks.push(record.session.task.clone());
                }
            }
        }
        let total_seconds: u64 = self
            .records
            .iter()
            .map(|r| u64::from(r.session.elapsed_secs))
            .sum();
        let total_xp: u64 = self.records.iter().map(|r| r.session.xp).sum();
        let level = (total_xp / 1000 + 1).min(u32::MAX as u64) as u32;
        let (current_streak, longest_streak) = streaks(&days, today, self.config.streak_minutes);
        let sessions = self
            .records
            .iter()
            .rev()
            .map(|r| self.session_for_snapshot(r))
            .collect();
        let active = self
            .active_index()
            .map(|i| self.session_for_snapshot(&self.records[i]));
        let app_blocks: u64 = self.records.iter().map(|r| r.app_blocks).sum();
        let website_blocks: u64 = self.records.iter().map(|r| r.website_blocks).sum();
        let completed_sessions = self.records.iter().filter(|r| r.work_finished).count() as u64;
        let interrupted_sessions = self
            .records
            .iter()
            .filter(|r| r.session.status == Status::Interrupted)
            .count() as u64;
        let achievements = achievements(
            &self.records,
            &days,
            &self.config,
            total_seconds,
            longest_streak,
            level,
            app_blocks,
            website_blocks,
        );
        Ok(Snapshot {
            config: self.config.clone(),
            active,
            sessions,
            total_seconds,
            total_xp,
            level,
            level_xp: total_xp % 1000,
            level_next_xp: 1000,
            current_streak,
            longest_streak,
            achievements,
            days: days.into_values().collect(),
            app_blocks,
            website_blocks,
            completed_sessions,
            interrupted_sessions,
        })
    }
    pub fn export_json(&self) -> Result<String> {
        Ok(serde_json::to_string_pretty(&self.snapshot()?)?)
    }
    pub fn export_csv(&self) -> Result<String> {
        let mut output = String::from(
            "id,task,category,started_at,ended_at,planned_seconds,focus_seconds,status,strict,outcome,xp,reason\r\n",
        );
        for record in &self.records {
            let s = &record.session;
            let fields = [
                s.id.clone(),
                s.task.clone(),
                s.category.clone(),
                s.started_at.clone(),
                s.ended_at.clone().unwrap_or_default(),
                s.planned_secs.to_string(),
                s.elapsed_secs.to_string(),
                enum_text(&s.status)?,
                enum_text(&s.strict)?,
                enum_text(&s.outcome)?,
                s.xp.to_string(),
                s.reason.clone().unwrap_or_default(),
            ];
            output.push_str(
                &fields
                    .iter()
                    .map(|s| csv_field(s))
                    .collect::<Vec<_>>()
                    .join(","),
            );
            output.push_str("\r\n");
        }
        Ok(output)
    }
}
fn enum_text<T: Serialize>(v: &T) -> Result<String> {
    Ok(serde_json::to_value(v)?
        .as_str()
        .unwrap_or_default()
        .to_owned())
}
fn csv_field(value: &str) -> String {
    // Excel/Sheets must not interpret task text as a formula on export.
    let trimmed = value.trim_start();
    let prefix = if trimmed.starts_with(['=', '+', '-', '@', '\t', '\r']) {
        "'"
    } else {
        ""
    };
    format!("\"{}{}\"", prefix, value.replace('"', "\"\""))
}
fn streaks(days: &BTreeMap<String, Day>, today: NaiveDate, minutes: u32) -> (u32, u32) {
    let qualified: Vec<NaiveDate> = days
        .values()
        .filter(|d| d.seconds >= u64::from(minutes) * 60)
        .filter_map(|d| NaiveDate::parse_from_str(&d.date, "%Y-%m-%d").ok())
        .filter(|d| *d <= today)
        .collect();
    let mut longest = 0;
    let mut run = 0;
    let mut previous: Option<NaiveDate> = None;
    for date in &qualified {
        run = if previous.and_then(|p| p.succ_opt()) == Some(*date) {
            run + 1
        } else {
            1
        };
        longest = longest.max(run);
        previous = Some(*date);
    }
    let mut cursor = if qualified.last() == Some(&today) {
        today
    } else {
        today.pred_opt().unwrap_or(today)
    };
    let mut current = 0;
    while qualified.binary_search(&cursor).is_ok() {
        current += 1;
        let Some(day) = cursor.pred_opt() else {
            break;
        };
        cursor = day;
    }
    (current, longest)
}
#[allow(clippy::too_many_arguments)]
fn achievements(
    records: &[Record],
    days: &BTreeMap<String, Day>,
    config: &Config,
    total: u64,
    streak: u32,
    level: u32,
    app_blocks: u64,
    website_blocks: u64,
) -> Vec<Achievement> {
    let finished: Vec<&Record> = records
        .iter()
        .filter(|r| r.work_finished && r.session.elapsed_secs >= 60)
        .collect();
    let finish_count = finished.len();
    let complete_task = records
        .iter()
        .any(|r| r.session.outcome == Outcome::Completed && r.session.elapsed_secs >= 60);
    let hour_finish = |predicate: fn(u32) -> bool| {
        finished.iter().any(|r| {
            r.session
                .ended_at
                .as_ref()
                .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                .is_some_and(|t| predicate(t.hour()))
        })
    };
    let mut weeks: BTreeMap<(i32, u32), u64> = BTreeMap::new();
    for day in days.values() {
        if let Ok(date) = NaiveDate::parse_from_str(&day.date, "%Y-%m-%d") {
            let week = date.iso_week();
            *weeks.entry((week.year(), week.week())).or_default() += day.seconds;
        }
    }
    let criteria = [
        (
            "first",
            "第一步",
            "完整完成一次至少 1 分钟的专注",
            finish_count >= 1,
        ),
        (
            "pomodoro",
            "初见番茄",
            "完整完成一次至少 25 分钟的专注",
            finished.iter().any(|r| r.session.elapsed_secs >= 1500),
        ),
        (
            "fifty",
            "渐入佳境",
            "完整完成一次至少 50 分钟的专注",
            finished.iter().any(|r| r.session.elapsed_secs >= 3000),
        ),
        (
            "ninety",
            "枝繁叶茂",
            "完整完成一次至少 90 分钟的专注",
            finished.iter().any(|r| r.session.elapsed_secs >= 5400),
        ),
        ("hour", "一小时的积累", "累计有效专注 1 小时", total >= 3600),
        (
            "ten_hours",
            "扎下根来",
            "累计有效专注 10 小时",
            total >= 36000,
        ),
        (
            "fifty_hours",
            "一片绿荫",
            "累计有效专注 50 小时",
            total >= 180000,
        ),
        (
            "hundred_hours",
            "根深叶茂",
            "累计有效专注 100 小时",
            total >= 360000,
        ),
        (
            "five_sessions",
            "初成习惯",
            "完整完成 5 次至少 1 分钟的专注",
            finish_count >= 5,
        ),
        (
            "ten_sessions",
            "十次耕耘",
            "完整完成 10 次至少 1 分钟的专注",
            finish_count >= 10,
        ),
        (
            "twenty_five_sessions",
            "稳步生长",
            "完整完成 25 次至少 1 分钟的专注",
            finish_count >= 25,
        ),
        (
            "hundred_sessions",
            "百次用心",
            "完整完成 100 次至少 1 分钟的专注",
            finish_count >= 100,
        ),
        (
            "three_days",
            "连续萌芽",
            "达到过连续 3 天的专注门槛",
            streak >= 3,
        ),
        (
            "seven_days",
            "七日不辍",
            "达到过连续 7 天的专注门槛",
            streak >= 7,
        ),
        (
            "thirty_days",
            "三十日",
            "达到过连续 30 天的专注门槛",
            streak >= 30,
        ),
        (
            "early",
            "清晨学者",
            "上午 8 点前完整完成至少 1 分钟专注",
            hour_finish(|h| h < 8),
        ),
        (
            "evening",
            "晚间耕耘",
            "18–23 点完整完成至少 1 分钟专注",
            hour_finish(|h| (18..23).contains(&h)),
        ),
        (
            "focus",
            "坚守",
            "完整完成一次专注或深度专注，至少 1 分钟",
            finished.iter().any(|r| r.session.strict != Strict::Gentle),
        ),
        (
            "deep",
            "深度扎根",
            "完整完成一次至少 1 分钟的深度专注",
            finished.iter().any(|r| r.session.strict == Strict::Deep),
        ),
        (
            "app_guard",
            "守住边界",
            "专注期间累计实际拦截应用 10 次",
            app_blocks >= 10,
        ),
        (
            "web_guard",
            "留在当下",
            "专注期间累计实际拦截网站 10 次",
            website_blocks >= 10,
        ),
        (
            "daily_goal",
            "今日丰收",
            "任一天有效专注达到当前每日目标",
            days.values()
                .any(|d| d.seconds >= u64::from(config.daily_goal_minutes) * 60),
        ),
        (
            "weekly_goal",
            "一周耕耘",
            "任一自然周有效专注达到当前每周目标",
            weeks
                .values()
                .any(|s| *s >= u64::from(config.weekly_goal_minutes) * 60),
        ),
        (
            "task_done",
            "有所完成",
            "完成至少 1 分钟专注并记录任务已完成",
            complete_task,
        ),
        ("level_two", "新枝", "通过有效专注达到 Lv.2", level >= 2),
        (
            "level_five",
            "自己的花园",
            "通过有效专注达到 Lv.5",
            level >= 5,
        ),
    ];
    criteria
        .into_iter()
        .map(|(id, title, description, unlocked)| Achievement {
            id: id.into(),
            title: title.into(),
            description: description.into(),
            unlocked,
        })
        .collect()
}

#[cfg(test)]
mod tests;
