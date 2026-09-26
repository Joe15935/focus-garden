//! Local-only desktop boundary. The legacy command engine is retained; unsafe
//! system transports and the upstream wall-clock Pomodoro are not exposed.
use std::sync::{Arc, Mutex};

use chrono::TimeZone;
use focuser_app::{Command, CommandErrorPayload, CommandResult};
use focuser_core::garden::{Config, GardenService, Outcome, StartRequest};
use serde::Deserialize;
use serde_json::{Value, json};
use tauri::{AppHandle, State};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_dialog::DialogExt;

pub type GardenState = Arc<Mutex<GardenService>>;

#[derive(Deserialize)]
pub struct Envelope {
    cmd: String,
    #[serde(default)]
    args: Value,
}

fn error(message: impl Into<String>) -> CommandErrorPayload {
    CommandErrorPayload {
        code: "validation".into(),
        message: message.into(),
    }
}

fn localized_error(error: focuser_app::CommandError) -> CommandErrorPayload {
    let code = error.code().to_string();
    let message = match code.as_str() {
        "block_list_not_found" => "没有找到这份屏蔽列表，请重新选择。",
        "rule_not_found" => "这条规则已不存在，请刷新列表。",
        "allowance_not_found" => "没有找到这项每日额度，请刷新列表。",
        "protected" => "当前规则正在受保护，请先安全结束专注。",
        "validation" => "输入内容不符合要求，请检查名称、网址与时长。",
        "unsupported" => "这项操作暂不支持。",
        _ => "本地操作未完成，请重试；若仍失败，请保留数据并重启应用。",
    };
    CommandErrorPayload {
        code,
        message: message.into(),
    }
}

fn read_only(command: &Command) -> bool {
    matches!(
        command,
        Command::ListBlockLists
            | Command::GetStats { .. }
            | Command::GetBlockedEvents { .. }
            | Command::GetStatsRetention
            | Command::GetProtectionStatus
            | Command::GetSetting { .. }
            | Command::GetBlockingHealth
            | Command::PomodoroStatus
            | Command::PomodoroPresets
            | Command::PomodoroHistory { .. }
            | Command::AllowanceList
            | Command::AllowanceHistory { .. }
            | Command::ExportConfiguration
            | Command::CheckDomain { .. }
            | Command::GetBrowserStatus
            | Command::GetAppIcons { .. }
            | Command::AppVersion
            | Command::AllowanceDrainNotifications
            | Command::PomodoroDrainEvents
    )
}

fn strict_work(service: &GardenService) -> Result<bool, String> {
    let snapshot = serde_json::to_value(service.snapshot().map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    Ok(snapshot["active"]["status"] == "work" && snapshot["active"]["strict"] != "gentle")
}

#[tauri::command(async)]
pub fn run_command(
    state: State<'_, Arc<crate::AppState>>,
    garden: State<'_, GardenState>,
    command: Command,
) -> Result<CommandResult, CommandErrorPayload> {
    let service = garden
        .lock()
        .map_err(|_| error("专注记录暂时不可用，请重启应用。"))?;
    if matches!(
        command,
        Command::EnableProtection { .. }
            | Command::PomodoroStart { .. }
            | Command::PomodoroPause
            | Command::PomodoroResume
            | Command::PomodoroSkip
            | Command::PomodoroStop
            | Command::ApplyBlocks
            | Command::RemoveBlocks
    ) {
        return Err(error(
            "请从花园首页开始或提前结束专注。此版本不修改系统网络设置。",
        ));
    }
    if !read_only(&command) && strict_work(&service).map_err(error)? {
        return Err(error(
            "专注期间暂时不能修改规则。需要调整时，请先使用“提前结束”。",
        ));
    }
    if let Command::SetSetting { ref key, ref value } = command {
        if key == "block_unsupported_browsers" || key == "extension_grace_period" {
            return Err(error("本应用不会自动退出未安装扩展的浏览器。"));
        }
        if key.starts_with("garden_app_mode:")
            && !matches!(value.as_str(), "blacklist" | "whitelist")
        {
            return Err(error("请选择屏蔽名单或允许名单。"));
        }
    }
    if let Command::GetBlockedEvents { from, to } = command {
        if from >= to {
            return Err(error("请选择有效的日期范围。"));
        }
        let boundary = |date: chrono::NaiveDate| {
            chrono::Local
                .from_local_datetime(&date.and_hms_opt(0, 0, 0).unwrap())
                .earliest()
                .map(|date| date.with_timezone(&chrono::Utc))
                .ok_or_else(|| error("此日期的本地时间边界无效，请调整日期。"))
        };
        let start = boundary(from)?;
        let end = boundary(to)?;
        let engine = state
            .engine
            .lock()
            .map_err(|_| error("暂时无法读取拦截记录。"))?;
        let events = engine
            .db()
            .get_blocked_events(&start.to_rfc3339(), &end.to_rfc3339())
            .map_err(|_| error("暂时无法读取拦截记录。"))?
            .into_iter()
            .filter(|event| {
                chrono::DateTime::parse_from_rfc3339(&event.timestamp)
                    .is_ok_and(|time| time >= start && time < end)
            })
            .collect();
        return Ok(CommandResult::BlockedEvents(events));
    }
    // New lists start inactive. Editing a list must not unexpectedly interrupt work.
    let creating = matches!(command, Command::CreateBlockList { .. });
    let result = focuser_app::execute(&state, command).map_err(localized_error)?;
    if creating && let CommandResult::BlockList(mut list) = result {
        list.enabled = false;
        let mut engine = state.engine.lock().map_err(|_| error("规则暂时不可用。"))?;
        engine
            .db()
            .update_block_list(&list)
            .map_err(|e| error(e.to_string()))?;
        engine.refresh().map_err(|e| error(e.to_string()))?;
        return Ok(CommandResult::BlockList(list));
    }
    Ok(result)
}

/// The same check the home page relies on: a focus session must name a real block list.
pub(crate) fn ensure_block_list(state: &crate::AppState, list_id: &str) -> Result<(), String> {
    let engine = state.engine.lock().map_err(|_| "无法读取屏蔽列表。")?;
    let id = uuid::Uuid::parse_str(list_id).map_err(|_| "请选择屏蔽列表。")?;
    engine
        .db()
        .get_block_list(id)
        .map_err(|_| "屏蔽列表已不存在，请重新选择。")?;
    Ok(())
}

#[tauri::command(async)]
pub fn garden_command(
    app: AppHandle,
    state: State<'_, Arc<crate::AppState>>,
    garden: State<'_, GardenState>,
    command: Envelope,
) -> Result<Value, String> {
    let mut service = garden
        .lock()
        .map_err(|_| "无法读取专注记录。".to_string())?;
    let to_json = |v| serde_json::to_value(v).map_err(|e| e.to_string());
    match command.cmd.as_str() {
        "snapshot" => to_json(service.snapshot().map_err(|e| e.to_string())?),
        "start" => {
            let request: StartRequest =
                serde_json::from_value(command.args).map_err(|_| "专注设置不完整。")?;
            ensure_block_list(&state, &request.list_id)?;
            to_json(service.start(request).map_err(|e| e.to_string())?)
        }
        "request_exit" => to_json(service.request_exit().map_err(|e| e.to_string())?),
        "confirm_exit" => to_json(
            service
                .confirm_exit(
                    command.args["reason"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string(),
                    command.args["confirmation"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string(),
                )
                .map_err(|e| e.to_string())?,
        ),
        "set_outcome" => {
            let id = command.args["id"]
                .as_str()
                .ok_or("未选择专注记录。")?
                .to_string();
            let outcome: Outcome = serde_json::from_value(command.args["outcome"].clone())
                .map_err(|_| "请选择任务完成情况。")?;
            to_json(
                service
                    .set_outcome(id, outcome)
                    .map_err(|e| e.to_string())?,
            )
        }
        "update_config" => {
            let value = command.args.get("config").unwrap_or(&command.args).clone();
            let config: Config = serde_json::from_value(value).map_err(|_| "设置格式无效。")?;
            to_json(service.update_config(config).map_err(|e| e.to_string())?)
        }
        "export_json" | "export_csv" => {
            let is_json = command.cmd == "export_json";
            let data = if is_json {
                let garden: Value =
                    serde_json::from_str(&service.export_json().map_err(|e| e.to_string())?)
                        .map_err(|e| e.to_string())?;
                let lists = match focuser_app::execute(&state, Command::ExportConfiguration)
                    .map_err(|e| e.to_string())?
                {
                    CommandResult::Text(v) => v,
                    _ => return Err("无法导出屏蔽列表。".into()),
                };
                serde_json::to_string_pretty(&json!({"format":"focus-garden-backup","version":1,"garden":garden,"block_lists":serde_json::from_str::<Value>(&lists).map_err(|e|e.to_string())?})).map_err(|e|e.to_string())?
            } else {
                service.export_csv().map_err(|e| e.to_string())?
            };
            drop(service);
            let extension = if is_json { "json" } else { "csv" };
            let filename = format!(
                "专注花园-{}.{}",
                chrono::Local::now().format("%Y%m%d-%H%M%S"),
                extension
            );
            let path = app
                .dialog()
                .file()
                .set_title("导出到本机")
                .set_file_name(filename)
                .add_filter(extension, &[extension])
                .blocking_save_file();
            if let Some(path) = path {
                let path = path.to_string();
                std::fs::write(&path, data).map_err(|e| format!("导出失败：{e}"))?;
                Ok(json!(path))
            } else {
                Ok(Value::Null)
            }
        }
        _ => Err("暂不支持这个操作。".into()),
    }
}

#[tauri::command(async)]
pub fn installed_apps() -> Result<Vec<crate::mac_guard::InstalledApp>, String> {
    crate::mac_guard::installed_apps()
}

#[tauri::command]
pub fn mac_health() -> crate::mac_guard::MacHealth {
    crate::mac_guard::health()
}

#[tauri::command(async)]
pub fn request_browser_permission(browser: String) -> Result<crate::mac_guard::MacHealth, String> {
    crate::mac_guard::request_browser_permission(&browser)
}

#[tauri::command]
pub fn is_autostart_enabled(app: AppHandle) -> Result<bool, String> {
    app.autolaunch()
        .is_enabled()
        .map_err(|e| format!("无法检查登录启动：{e}"))
}

#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    if enabled {
        app.autolaunch().enable()
    } else {
        app.autolaunch().disable()
    }
    .map_err(|e| format!("无法设置登录启动：{e}"))
}

#[tauri::command(async)]
pub fn save_configuration(app: AppHandle, json: String) -> Result<Option<String>, String> {
    let path = app
        .dialog()
        .file()
        .set_title("导出屏蔽列表")
        .set_file_name("专注花园-屏蔽列表.json")
        .add_filter("JSON", &["json"])
        .blocking_save_file();
    if let Some(path) = path {
        let path = path.to_string();
        std::fs::write(&path, &json).map_err(|e| format!("保存失败：{e}"))?;
        Ok(Some(path))
    } else {
        Ok(None)
    }
}

#[tauri::command(async)]
pub fn pick_import_file(app: AppHandle) -> Result<Option<String>, String> {
    let path = app
        .dialog()
        .file()
        .set_title("导入屏蔽列表")
        .add_filter("JSON", &["json"])
        .blocking_pick_file();
    match path {
        Some(path) => {
            let path = path.to_string();
            if std::fs::metadata(&path).map_err(|e| e.to_string())?.len() > 5_000_000 {
                return Err("配置文件超过 5 MB，请检查文件。".into());
            }
            std::fs::read_to_string(path)
                .map(Some)
                .map_err(|e| format!("读取失败：{e}"))
        }
        None => Ok(None),
    }
}

pub fn may_quit(garden: &GardenState) -> bool {
    garden
        .lock()
        .ok()
        .and_then(|s| strict_work(&s).ok())
        .is_some_and(|locked| !locked)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn all_legacy_mutation_escape_routes_are_not_read_only() {
        assert!(!read_only(&Command::PomodoroStop));
        assert!(!read_only(&Command::PomodoroSkip));
        assert!(!read_only(&Command::PomodoroPause));
        assert!(!read_only(&Command::DeleteAllData));
        assert!(!read_only(&Command::ResetSettings));
        assert!(!read_only(&Command::RemoveBlocks));
        assert!(!read_only(&Command::ImportConfiguration {
            json: "[]".into()
        }));
        assert!(!read_only(&Command::SetSetting {
            key: "garden_app_mode:1".into(),
            value: "whitelist".into()
        }));
        assert!(read_only(&Command::ListBlockLists));
        assert!(read_only(&Command::ExportConfiguration));
        assert!(read_only(&Command::AllowanceList));
    }
    #[test]
    fn frontend_blocked_event_payload_deserializes_as_real_command() {
        let value = include_str!("../frontend/src/test/fixtures/blocked-events-request.json");
        let command: Command = serde_json::from_str(value).unwrap();
        assert!(matches!(command, Command::GetBlockedEvents { from, to }
            if from.to_string() == "2026-09-21" && to.to_string() == "2026-09-22"));
    }
    #[test]
    fn backend_validation_is_shown_in_chinese() {
        let translated = localized_error(focuser_app::CommandError::Validation(
            "name must not be empty".into(),
        ));
        assert_eq!(translated.code, "validation");
        assert!(translated.message.contains("输入内容"));
        assert!(!translated.message.contains("name must"));
    }
}
