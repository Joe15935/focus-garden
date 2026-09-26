#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod garden_bridge;
mod mac_guard;
mod study_bridge;

use focuser_core::{BlockEngine, Database, garden::GardenService};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{
    Emitter, Manager,
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, Submenu},
    tray::TrayIconBuilder,
};
use tracing::{error, info};

pub use focuser_app::AppContext as AppState;
pub use garden_bridge::GardenState;

struct InstanceLock {
    _file: std::fs::File,
}

fn lock_data_directory(directory: &std::path::Path) -> Result<InstanceLock, String> {
    let file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(directory.join("instance.lock"))
        .map_err(|e| format!("无法锁定本地数据目录：{e}"))?;
    file.try_lock()
        .map_err(|_| "专注花园已在运行，请从菜单栏打开。".to_string())?;
    Ok(InstanceLock { _file: file })
}

pub fn data_dir() -> PathBuf {
    directories::BaseDirs::new()
        .expect("无法确定当前用户目录")
        .home_dir()
        .join("Library/Application Support/Focus Garden")
}

fn show(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn main() {
    tracing_subscriber::fmt().with_env_filter("warn").init();
    let built = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| show(app)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .invoke_handler(tauri::generate_handler![
            garden_bridge::run_command,
            garden_bridge::garden_command,
            garden_bridge::installed_apps,
            garden_bridge::mac_health,
            garden_bridge::request_browser_permission,
            garden_bridge::is_autostart_enabled,
            garden_bridge::set_autostart,
            garden_bridge::save_configuration,
            garden_bridge::pick_import_file,
            study_bridge::study_command,
        ])
        .setup(move |app| {
            let directory = data_dir();
            std::fs::create_dir_all(&directory).expect("无法创建本地数据目录");
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ =
                    std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700));
            }
            // The socket plugin focuses ordinary second launches; this OS lock also
            // prevents concurrent launches or stale sockets from opening two writers.
            app.manage(lock_data_directory(&directory).map_err(std::io::Error::other)?);
            let db =
                Database::open(directory.join("rules.sqlite3")).expect("无法读取本机规则数据库");
            if db.get_setting("language").ok().flatten().is_none() {
                let _ = db.set_setting("language", "zh");
            }
            let state = Arc::new(AppState::new_headless(
                BlockEngine::new(db).expect("无法加载规则"),
            ));
            let garden: GardenState = Arc::new(Mutex::new(
                GardenService::open(directory.join("garden.sqlite3")).expect("无法读取花园记录"),
            ));
            // Study data sits in its own file; failing to open it never blocks the garden.
            let study: study_bridge::StudyState =
                Arc::new(Mutex::new(study_bridge::StudyHandle::open(&directory)));
            app.manage(study);
            let setup_state = state.clone();
            let setup_garden = garden.clone();
            app.manage(state);
            app.manage(garden);
            let guarded_quit = MenuItemBuilder::with_id("app-quit", "退出专注花园")
                .accelerator("CmdOrCtrl+Q")
                .build(app)?;
            let application_menu = Submenu::with_items(
                app,
                "专注花园",
                true,
                &[
                    &PredefinedMenuItem::about(app, Some("关于专注花园"), None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::hide(app, Some("隐藏专注花园"))?,
                    &PredefinedMenuItem::hide_others(app, Some("隐藏其他应用"))?,
                    &PredefinedMenuItem::show_all(app, Some("显示全部"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &guarded_quit,
                ],
            )?;
            let edit_menu = Submenu::with_items(
                app,
                "编辑",
                true,
                &[
                    &PredefinedMenuItem::undo(app, Some("撤销"))?,
                    &PredefinedMenuItem::redo(app, Some("重做"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::cut(app, Some("剪切"))?,
                    &PredefinedMenuItem::copy(app, Some("复制"))?,
                    &PredefinedMenuItem::paste(app, Some("粘贴"))?,
                    &PredefinedMenuItem::select_all(app, Some("全选"))?,
                ],
            )?;
            let window_menu = Submenu::with_items(
                app,
                "窗口",
                true,
                &[
                    &PredefinedMenuItem::minimize(app, Some("最小化"))?,
                    &PredefinedMenuItem::close_window(app, Some("关闭窗口"))?,
                ],
            )?;
            app.set_menu(
                MenuBuilder::new(app)
                    .items(&[&application_menu, &edit_menu, &window_menu])
                    .build()?,
            )?;
            app.on_menu_event(|app, event| {
                if event.id().as_ref() == "app-quit" {
                    let allowed = app
                        .try_state::<GardenState>()
                        .is_none_or(|garden| garden_bridge::may_quit(&garden));
                    if allowed {
                        app.exit(0);
                    } else {
                        show(app);
                        let _ = app.emit("garden-exit-requested", "请先在首页申请提前结束。");
                    }
                }
            });
            let open = MenuItemBuilder::with_id("open", "打开专注花园").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "退出专注花园").build(app)?;
            let menu = MenuBuilder::new(app).items(&[&open, &quit]).build()?;
            let tray_garden = setup_garden.clone();
            let mut tray = TrayIconBuilder::with_id("garden-tray")
                .tooltip("专注花园 · 今天的努力，慢慢生长")
                .menu(&menu)
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "open" => show(app),
                    "quit" => {
                        if garden_bridge::may_quit(&tray_garden) {
                            app.exit(0);
                        } else {
                            show(app);
                            let _ = app.emit("garden-exit-requested", "请先在首页申请提前结束。");
                        }
                    }
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            mac_guard::start(
                app.handle().clone(),
                setup_state.clone(),
                setup_garden.clone(),
            );
            let clock_garden = setup_garden.clone();
            let clock_app = app.handle().clone();
            std::thread::spawn(move || {
                let mut last_phase = String::new();
                loop {
                    std::thread::sleep(Duration::from_secs(1));
                    if clock_garden
                        .lock()
                        .is_ok_and(|service| !service.has_active_session())
                    {
                        continue;
                    }
                    let result = clock_garden
                        .lock()
                        .map_err(|_| "无法锁定专注记录".to_string())
                        .and_then(|mut service| service.tick().map_err(|e| e.to_string()));
                    match result {
                        Ok(snapshot) => {
                            if let Ok(value) = serde_json::to_value(snapshot) {
                                let phase = value["active"]["status"]
                                    .as_str()
                                    .unwrap_or("idle")
                                    .to_string();
                                if !last_phase.is_empty() && phase != last_phase {
                                    let _ = clock_app.emit("garden-phase-changed", &phase);
                                }
                                last_phase = phase;
                            }
                        }
                        Err(e) => {
                            error!(error=%e,"garden clock failed");
                            let _ = clock_app
                                .emit("garden-error", "专注记录写入失败，请打开应用检查。");
                        }
                    }
                }
            });
            if std::env::args().any(|arg| arg == "--autostart")
                && let Some(window) = app.get_webview_window("main")
            {
                let _ = window.hide();
            }
            info!("Focus Garden ready");
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!());
    let app = match built {
        Ok(app) => app,
        Err(error) => {
            eprintln!("无法启动专注花园：{error}");
            return;
        }
    };
    app.run(move |app, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = event
            && app
                .try_state::<GardenState>()
                .is_some_and(|g| !garden_bridge::may_quit(&g))
        {
            api.prevent_exit();
            show(app);
            let _ = app.emit(
                "garden-exit-requested",
                "专注仍在进行，需要先申请提前结束。",
            );
        }
    });
}

#[cfg(test)]
mod instance_tests {
    use super::*;
    #[test]
    fn data_lock_excludes_second_writer_and_releases_after_drop() {
        let directory =
            std::env::temp_dir().join(format!("focus-garden-lock-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let first = lock_data_directory(&directory).unwrap();
        assert!(lock_data_directory(&directory).is_err());
        drop(first);
        assert!(lock_data_directory(&directory).is_ok());
        std::fs::remove_dir_all(directory).unwrap();
    }
}
