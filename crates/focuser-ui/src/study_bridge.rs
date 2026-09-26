//! Desktop boundary for the study navigator ("学习导航").
//!
//! Study data lives in its own `study.sqlite3`. Starting a study task goes
//! through the existing `GardenService::start` under the garden lock, with the
//! same block-list check as the home page, so the timer, strictness, exit rules
//! and XP stay exactly the garden's. This module never ends or shortens a
//! running session.
use std::sync::{Arc, Mutex};

use chrono::{Local, NaiveDate};
use focuser_core::garden::{StartRequest, Strict};
use focuser_core::study::{
    PlanRevision, SessionLink, StudyBackup, StudyError, StudyEvent, StudyStore,
};
use serde::Deserialize;
use serde_json::{Value, json};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::garden_bridge::{GardenState, ensure_block_list};

pub struct StudyHandle {
    store: Option<StudyStore>,
    open_error: Option<String>,
    last_auto_backup: Option<NaiveDate>,
}

impl StudyHandle {
    pub fn open(directory: &std::path::Path) -> Self {
        match StudyStore::open(
            directory.join("study.sqlite3"),
            directory.join("study-backups"),
        ) {
            Ok(store) => {
                let mut handle = Self {
                    store: Some(store),
                    open_error: None,
                    last_auto_backup: None,
                };
                handle.auto_backup();
                handle
            }
            Err(e) => {
                tracing::error!(error = %e, "study store unavailable");
                Self {
                    store: None,
                    open_error: Some(e.to_string()),
                    last_auto_backup: None,
                }
            }
        }
    }

    fn auto_backup(&mut self) {
        let today = Local::now().date_naive();
        if self.last_auto_backup == Some(today) {
            return;
        }
        if let Some(store) = &self.store {
            match store.auto_backup() {
                Ok(_) => self.last_auto_backup = Some(today),
                Err(e) => tracing::warn!(error = %e, "study auto backup failed"),
            }
        }
    }

    fn store(&mut self) -> Result<&mut StudyStore, String> {
        let error = self.open_error.clone();
        self.store.as_mut().ok_or_else(|| {
            format!(
                "学习导航数据暂时无法打开：{}。花园和屏蔽功能不受影响；请不要删除数据文件，先导出或联系维护者。",
                error.unwrap_or_default()
            )
        })
    }
}

pub type StudyState = Arc<Mutex<StudyHandle>>;

#[derive(Deserialize)]
pub struct Envelope {
    cmd: String,
    #[serde(default)]
    args: Value,
}

#[derive(Deserialize)]
struct StartTask {
    occurrence_id: String,
    date: String,
    task_key: String,
    title: String,
    category: String,
    minutes: u32,
    list_id: String,
    strict: Strict,
}

/// Categories that may become garden focus time. Classes, labs, travel,
/// running, gym and meals never do.
fn garden_category(category: &str) -> Option<&'static str> {
    Some(match category {
        "law-video" => "听课",
        "law-review" => "复习",
        "law-practice" => "做题",
        "law-output" => "口述",
        "english" => "英语",
        _ => return None,
    })
}

fn text(e: StudyError) -> String {
    e.to_string()
}

fn arg<T: for<'de> Deserialize<'de>>(args: &Value, key: &str, message: &str) -> Result<T, String> {
    serde_json::from_value(args.get(key).cloned().unwrap_or(Value::Null))
        .map_err(|_| message.to_string())
}

fn start_task(
    state: &crate::AppState,
    garden: &GardenState,
    study: &StudyState,
    args: Value,
) -> Result<Value, String> {
    let task: StartTask = serde_json::from_value(args).map_err(|_| "任务信息不完整。")?;
    let category = garden_category(&task.category)
        .ok_or("课程、路途、跑步和生活事项不能变成花园专注时长。")?;
    if !(1..=300).contains(&task.minutes) {
        return Err("任务时长需在 1–300 分钟之间。".into());
    }
    // Lock order everywhere: garden, then study.
    let mut garden = garden
        .lock()
        .map_err(|_| "无法读取专注记录。".to_string())?;
    if garden.has_active_session() {
        return Err(
            "已有进行中的专注。请先在「今天」完成或按原有安全流程提前结束；学习导航不会替你终止它。"
                .into(),
        );
    }
    ensure_block_list(state, &task.list_id)?;
    let mut study = study
        .lock()
        .map_err(|_| "学习导航数据暂时不可用。".to_string())?;
    let store = study.store()?;
    let snapshot = garden
        .start(StartRequest {
            list_id: task.list_id.clone(),
            task: task.title.clone(),
            category: category.into(),
            work_secs: task.minutes * 60,
            break_secs: 0,
            strict: task.strict,
        })
        .map_err(|e| e.to_string())?;
    let session_id = snapshot
        .active
        .as_ref()
        .map(|s| s.id.clone())
        .ok_or("专注已提交，但没有读到会话。请回到「今天」查看，不要重复开始。")?;
    let link = SessionLink {
        session_id: session_id.clone(),
        occurrence_id: task.occurrence_id,
        date: task.date,
        task_key: task.task_key,
        title: task.title,
        minutes: task.minutes,
        created_at: Local::now().fixed_offset().to_rfc3339(),
    };
    if let Err(e) = store.link_session(&link) {
        return Err(format!(
            "专注已经开始，但任务关联没有保存（{e}）。计时照常进行；结束后请在学习导航手动记录结果。"
        ));
    }
    Ok(json!({ "session_id": session_id, "garden": snapshot }))
}

fn snapshot_json(store: &StudyStore) -> Result<Value, String> {
    let snapshot = store.snapshot().map_err(text)?;
    let backups = store.list_backups().map_err(text)?;
    let mut value = serde_json::to_value(snapshot).map_err(|e| e.to_string())?;
    value["backups"] = serde_json::to_value(backups).map_err(|e| e.to_string())?;
    value["mirror_dir"] = json!(store.get_setting("mirror_dir").map_err(text)?);
    Ok(value)
}

#[tauri::command(async)]
pub fn study_command(
    app: AppHandle,
    state: State<'_, Arc<crate::AppState>>,
    garden: State<'_, GardenState>,
    study: State<'_, StudyState>,
    command: Envelope,
) -> Result<Value, String> {
    let args = command.args;
    if command.cmd == "start_task" {
        return start_task(&state, &garden, &study, args);
    }
    if command.cmd == "pick_file" {
        return pick_file(&app, &args);
    }
    if command.cmd == "save_text" {
        return save_text(&app, &args);
    }
    if command.cmd == "ocr_images" {
        return ocr_images(&app);
    }
    if command.cmd == "mirror_choose" {
        let Some(folder) = app
            .dialog()
            .file()
            .set_title("选择手机也能看到的文件夹（例如 iCloud 云盘）")
            .blocking_pick_folder()
        else {
            return Ok(Value::Null);
        };
        let folder = folder.to_string();
        let mut handle = study
            .lock()
            .map_err(|_| "学习导航数据暂时不可用。".to_string())?;
        handle
            .store()?
            .set_setting("mirror_dir", Some(&folder))
            .map_err(text)?;
        return Ok(Value::String(folder));
    }
    let mut handle = study
        .lock()
        .map_err(|_| "学习导航数据暂时不可用。".to_string())?;
    if command.cmd == "snapshot" {
        handle.auto_backup();
    }
    let store = handle.store()?;
    match command.cmd.as_str() {
        "snapshot" => snapshot_json(store),
        "mirror_clear" => {
            store.set_setting("mirror_dir", None).map_err(text)?;
            Ok(Value::Null)
        }
        "mirror_write" => mirror_write(store, &args),
        "save_doc" => {
            let expected: i64 = arg(&args, "expected_revision", "缺少数据版本。")?;
            let doc = args.get("doc").cloned().ok_or("缺少学习设置。")?;
            let revision = store.save_doc(expected, &doc).map_err(text)?;
            Ok(json!({ "revision": revision }))
        }
        "append_event" => {
            let event: StudyEvent = arg(&args, "event", "学习记录格式无效。")?;
            let inserted = store.append_event(&event).map_err(text)?;
            Ok(json!({ "inserted": inserted }))
        }
        "upsert_review" => {
            let card = args.get("card").cloned().ok_or("缺少复习卡。")?;
            store.upsert_review(&card).map_err(text)?;
            Ok(Value::Null)
        }
        "record_plan" => {
            let plan: PlanRevision = arg(&args, "plan", "计划记录格式无效。")?;
            let id = store.record_plan(&plan).map_err(text)?;
            Ok(json!({ "id": id }))
        }
        "backup_now" => {
            let name = store.backup_now("manual").map_err(text)?;
            Ok(json!({ "file_name": name }))
        }
        "restore_backup" => {
            let name: String = arg(&args, "file_name", "请选择备份。")?;
            let expected: i64 = arg(&args, "expected_revision", "缺少数据版本。")?;
            let revision = store.restore(&name, expected).map_err(text)?;
            Ok(json!({ "revision": revision }))
        }
        "export_backup" => {
            let backup = store.export().map_err(text)?;
            serde_json::to_value(backup).map_err(|e| e.to_string())
        }
        "import_backup" => {
            let backup: StudyBackup = arg(&args, "backup", "备份格式无效，原数据未改动。")?;
            let expected: i64 = arg(&args, "expected_revision", "缺少数据版本。")?;
            let revision = store.import(&backup, expected).map_err(text)?;
            Ok(json!({ "revision": revision }))
        }
        _ => Err("学习导航暂不支持这个操作。".into()),
    }
}

fn pick_file(app: &AppHandle, args: &Value) -> Result<Value, String> {
    let kind = args["kind"].as_str().unwrap_or("json");
    let (title, filter): (&str, &[&str]) = match kind {
        "json" => ("选择学习导航备份或初始配置", &["json"]),
        "csv" => ("选择课表 CSV", &["csv"]),
        "ics" => ("选择日历文件（.ics）", &["ics", "ical", "ifb"]),
        _ => return Err("不支持的文件类型。".into()),
    };
    let Some(path) = app
        .dialog()
        .file()
        .set_title(title)
        .add_filter(kind, filter)
        .blocking_pick_file()
    else {
        return Ok(Value::Null);
    };
    let path = path.to_string();
    if std::fs::metadata(&path).map_err(|e| e.to_string())?.len() > 5_000_000 {
        return Err("文件超过 5 MB，请检查内容。".into());
    }
    std::fs::read_to_string(&path)
        .map(Value::String)
        .map_err(|e| format!("读取失败：{e}"))
}

fn save_text(app: &AppHandle, args: &Value) -> Result<Value, String> {
    let content = args["content"].as_str().ok_or("没有可保存的内容。")?;
    let extension = args["extension"].as_str().unwrap_or("json");
    if !matches!(extension, "json" | "ics" | "csv") {
        return Err("不支持的文件类型。".into());
    }
    if content.len() > 20_000_000 {
        return Err("内容过大。".into());
    }
    let file_name = args["file_name"]
        .as_str()
        .filter(|name| !name.contains(['/', '\\']) && name.chars().count() <= 120)
        .unwrap_or("学习导航");
    let Some(path) = app
        .dialog()
        .file()
        .set_title("保存到本机")
        .set_file_name(file_name)
        .add_filter(extension, &[extension])
        .blocking_save_file()
    else {
        return Ok(Value::Null);
    };
    let path = path.to_string();
    // Write beside the target first, then rename, so a crash never leaves half a file.
    let temporary = format!("{path}.partial");
    std::fs::write(&temporary, content).map_err(|e| format!("保存失败：{e}"))?;
    std::fs::rename(&temporary, &path).map_err(|e| format!("保存失败：{e}"))?;
    Ok(Value::String(path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_study_work_becomes_garden_time() {
        for category in [
            "law-video",
            "law-review",
            "law-practice",
            "law-output",
            "english",
        ] {
            assert!(garden_category(category).is_some(), "{category}");
        }
        for category in ["class", "lab", "run", "gym", "life", "travel", "other", ""] {
            assert!(garden_category(category).is_none(), "{category}");
        }
    }

    #[test]
    fn start_task_payload_matches_frontend() {
        let value = json!({
            "occurrence_id": "2026-09-28:law-1",
            "date": "2026-09-28",
            "task_key": "law-1",
            "title": "法硕第1节",
            "category": "law-video",
            "minutes": 55,
            "list_id": "12345678-1234-4123-8123-123456789abc",
            "strict": "focus"
        });
        let task: StartTask = serde_json::from_value(value).unwrap();
        assert_eq!(task.minutes, 55);
        assert_eq!(task.strict, Strict::Focus);
    }

    #[test]
    fn base64_matches_rfc4648_vectors() {
        for (input, expected) in [
            ("", ""),
            ("f", "Zg=="),
            ("fo", "Zm8="),
            ("foo", "Zm9v"),
            ("foob", "Zm9vYg=="),
            ("fooba", "Zm9vYmE="),
            ("foobar", "Zm9vYmFy"),
        ] {
            assert_eq!(base64(input.as_bytes()), expected);
        }
    }

    #[test]
    fn mirror_only_writes_fixed_names_into_the_chosen_folder() {
        let dir = std::env::temp_dir().join(format!("study-mirror-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let store = StudyStore::open(dir.join("s.sqlite3"), dir.join("b")).unwrap();
        // No folder chosen: nothing happens.
        assert_eq!(
            mirror_write(&store, &json!({"files": []})).unwrap(),
            Value::Null
        );
        let out = dir.join("out");
        std::fs::create_dir_all(&out).unwrap();
        store
            .set_setting("mirror_dir", Some(out.to_str().unwrap()))
            .unwrap();
        assert!(
            mirror_write(
                &store,
                &json!({"files": [{"name": "../evil.html", "content": "x"}]})
            )
            .is_err()
        );
        mirror_write(
            &store,
            &json!({"files": [{"name": "学习导航-本周.html", "content": "<p>ok</p>"}]}),
        )
        .unwrap();
        assert_eq!(
            std::fs::read_to_string(out.join("学习导航-本周.html")).unwrap(),
            "<p>ok</p>"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn opening_a_fresh_directory_works() {
        let dir = std::env::temp_dir().join(format!("study-bridge-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut handle = StudyHandle::open(&dir);
        assert!(handle.store().is_ok());
        let _ = std::fs::remove_dir_all(&dir);
    }
}

/// Fixed file names only: the page can never choose where on disk it writes.
const MIRROR_FILES: [&str; 2] = ["学习导航-本周.html", "学习导航-本周.ics"];

fn mirror_write(store: &StudyStore, args: &Value) -> Result<Value, String> {
    let Some(dir) = store.get_setting("mirror_dir").map_err(text)? else {
        return Ok(Value::Null);
    };
    let dir = std::path::PathBuf::from(dir);
    if !dir.is_dir() {
        return Err("手机查看文件夹已不存在，请在「规则与数据」里重新选择。".into());
    }
    let files = args["files"].as_array().ok_or("没有要写入的内容。")?;
    let mut written = Vec::new();
    for file in files {
        let name = file["name"].as_str().unwrap_or_default();
        let content = file["content"].as_str().ok_or("文件内容无效。")?;
        if !MIRROR_FILES.contains(&name) {
            return Err("不允许的文件名。".into());
        }
        if content.len() > 5_000_000 {
            return Err("内容过大。".into());
        }
        let target = dir.join(name);
        let temporary = dir.join(format!(".{name}.partial"));
        std::fs::write(&temporary, content).map_err(|e| format!("写入失败：{e}"))?;
        std::fs::rename(&temporary, &target).map_err(|e| format!("写入失败：{e}"))?;
        written.push(target.display().to_string());
    }
    Ok(json!(written))
}

/// Standard base64 (RFC 4648) for returning a converted screenshot to the page.
fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            chunk.get(1).copied().unwrap_or(0),
            chunk.get(2).copied().unwrap_or(0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(TABLE[((n >> (18 - 6 * i)) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

fn ocr_images(app: &AppHandle) -> Result<Value, String> {
    let Some(paths) = app
        .dialog()
        .file()
        .set_title("选择课表截图（可多选，每周一张）")
        .add_filter("图片", &["png", "jpg", "jpeg", "heic", "heif"])
        .blocking_pick_files()
    else {
        return Ok(Value::Null);
    };
    if paths.len() > 30 {
        return Err("一次最多识别 30 张截图。".into());
    }
    let mut out = Vec::new();
    for path in paths {
        let path = std::path::PathBuf::from(path.to_string());
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        if std::fs::metadata(&path).map_err(|e| e.to_string())?.len() > 30_000_000 {
            return Err(format!("{name} 超过 30 MB。"));
        }
        let (png, boxes) = imp::recognize(&path)?;
        out.push(json!({
            "name": name,
            "data_url": format!("data:image/png;base64,{}", base64(&png)),
            "boxes": boxes,
        }));
    }
    Ok(Value::Array(out))
}

#[cfg(target_os = "macos")]
mod imp {
    use serde_json::Value;
    use std::io::Read;
    use std::path::Path;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    /// Apple's Vision text recognition through JavaScript for Automation. Runs
    /// entirely on this Mac; nothing is uploaded. The path is passed as an
    /// argument, never spliced into the script.
    const SCRIPT: &str = r#"
ObjC.import('Foundation');
ObjC.import('Vision');
function run(argv) {
  var url = $.NSURL.fileURLWithPath(argv[0]);
  var handler = $.VNImageRequestHandler.alloc.initWithURLOptions(url, $.NSDictionary.dictionary);
  var request = $.VNRecognizeTextRequest.alloc.init;
  request.setRecognitionLevel(0);
  request.setUsesLanguageCorrection(false);
  request.setRecognitionLanguages($(['zh-Hans', 'en-US']));
  var ok = handler.performRequestsError($.NSArray.arrayWithObject(request), null);
  if (!ok) throw new Error('vision failed');
  var results = request.results;
  var out = [];
  for (var i = 0; i < results.count; i++) {
    var obs = results.objectAtIndex(i);
    var candidates = obs.topCandidates(1);
    if (candidates.count === 0) continue;
    var best = candidates.objectAtIndex(0);
    var box = obs.boundingBox;
    out.push({ text: best.string.js, confidence: best.confidence, x: box.origin.x, y: box.origin.y, w: box.size.width, h: box.size.height });
  }
  return JSON.stringify(out);
}
"#;

    fn run(command: &mut Command, limit: Duration, what: &str) -> Result<Vec<u8>, String> {
        let mut child = command
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("{what}无法启动：{e}"))?;
        let started = Instant::now();
        loop {
            match child.try_wait().map_err(|e| e.to_string())? {
                Some(status) => {
                    let mut stdout = Vec::new();
                    if let Some(mut pipe) = child.stdout.take() {
                        pipe.read_to_end(&mut stdout).map_err(|e| e.to_string())?;
                    }
                    if !status.success() {
                        let mut stderr = String::new();
                        if let Some(mut pipe) = child.stderr.take() {
                            let _ = pipe.read_to_string(&mut stderr);
                        }
                        tracing::warn!(%stderr, "{what} failed");
                        return Err(format!("{what}没有成功，请换一张截图或手动添加。"));
                    }
                    return Ok(stdout);
                }
                None if started.elapsed() > limit => {
                    let _ = child.kill();
                    return Err(format!("{what}超时，请换一张较小的截图。"));
                }
                None => std::thread::sleep(Duration::from_millis(50)),
            }
        }
    }

    pub fn recognize(path: &Path) -> Result<(Vec<u8>, Value), String> {
        let dir = std::env::temp_dir().join(format!("focus-garden-ocr-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let png = dir.join("shot.png");
        let result = (|| {
            // sips ships with macOS; it also turns HEIC from an iPhone into PNG.
            run(
                Command::new("/usr/bin/sips")
                    .args(["-s", "format", "png"])
                    .arg(path)
                    .arg("--out")
                    .arg(&png),
                Duration::from_secs(30),
                "图片转换",
            )?;
            let stdout = run(
                Command::new("/usr/bin/osascript")
                    .args(["-l", "JavaScript", "-e", SCRIPT])
                    .arg(&png),
                Duration::from_secs(60),
                "文字识别",
            )?;
            let boxes: Value = serde_json::from_slice(&stdout)
                .map_err(|_| "文字识别结果无法读取。".to_string())?;
            let bytes = std::fs::read(&png).map_err(|e| e.to_string())?;
            Ok((bytes, boxes))
        })();
        let _ = std::fs::remove_dir_all(&dir);
        result
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    use serde_json::Value;
    use std::path::Path;

    pub fn recognize(_path: &Path) -> Result<(Vec<u8>, Value), String> {
        Err("截图识别使用 macOS 自带的文字识别，这台电脑不支持。".into())
    }
}
