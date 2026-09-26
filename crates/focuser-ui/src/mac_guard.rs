//! Focus Garden's reversible macOS enforcement adapter.
//!
//! Reuses Focuser's MIT rule types, schedules and allowance ledger. mado's
//! separately MIT-licensed macOS adapter supplies local foreground information;
//! website enrichment (which can fetch favicons) is deliberately never enabled.
//! A blocked application is asked to quit the normal way (like ⌘Q), so it
//! stops playing in the background; apps may still ask to save first. It is
//! never force-killed. This module never edits hosts or starts a server.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use focuser_common::allowance::AllowanceTick;
use focuser_common::host::{any_host_matches, canonical_host, host_matches, wildcard_matches};
use focuser_common::types::{AppMatchType, BlockList, ExceptionType, WebsiteMatchType};
use serde::Serialize;
use tauri::{Emitter, Manager};
use url::Url;

#[derive(Clone, Debug, Serialize)]
pub struct InstalledApp {
    pub name: String,
    pub bundle_id: String,
    pub path: String,
    pub executable: String,
    pub icon: Option<String>,
    pub protected: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct BrowserPermission {
    pub browser: String,
    pub bundle_id: String,
    pub status: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct ForegroundHealth {
    pub pid: i32,
    pub name: String,
    pub bundle_id: String,
    pub regular_app: bool,
    pub protected: bool,
    pub protection_reason: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct MacHealth {
    pub platform: String,
    pub accessibility_granted: bool,
    pub rules_active: bool,
    pub monitoring: bool,
    pub website_blocking_available: bool,
    pub front_browser: Option<String>,
    pub front_url_available: bool,
    pub front_app: Option<ForegroundHealth>,
    pub matched_rule: Option<String>,
    pub automation: Vec<BrowserPermission>,
    pub last_error: Option<String>,
    pub blocked_apps: u64,
    pub blocked_websites: u64,
}

impl Default for MacHealth {
    fn default() -> Self {
        Self {
            platform: std::env::consts::OS.into(),
            accessibility_granted: false,
            rules_active: false,
            monitoring: false,
            website_blocking_available: false,
            front_browser: None,
            front_url_available: false,
            front_app: None,
            matched_rule: None,
            automation: Vec::new(),
            last_error: None,
            blocked_apps: 0,
            blocked_websites: 0,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct BlockNotice {
    pub kind: String,
    pub target: String,
    pub list_name: String,
    pub message: String,
    pub confirmed: bool,
}

static HEALTH: OnceLock<Mutex<MacHealth>> = OnceLock::new();

fn update_health(update: impl FnOnce(&mut MacHealth)) {
    if let Ok(mut health) = HEALTH
        .get_or_init(|| Mutex::new(MacHealth::default()))
        .lock()
    {
        update(&mut health);
    }
}

/// Read-only permission checks never cause a system permission prompt.
pub fn health() -> MacHealth {
    let mut health = HEALTH
        .get_or_init(|| Mutex::new(MacHealth::default()))
        .lock()
        .map(|value| value.clone())
        .unwrap_or_default();
    #[cfg(target_os = "macos")]
    {
        health.accessibility_granted = mado::is_accessibility_trusted();
        health.automation = BROWSERS
            .iter()
            .map(|browser| BrowserPermission {
                browser: browser.name.into(),
                bundle_id: browser.id.into(),
                status: native::automation_permission(browser.id, false).into(),
            })
            .collect();
        health.website_blocking_available =
            health.accessibility_granted && health.automation.iter().any(|p| p.status == "granted");
    }
    health
}

/// Call only from an explicit user action and off the main thread: Apple's
/// permission dialog can wait indefinitely for the user's answer.
pub fn request_browser_permission(browser: &str) -> Result<MacHealth, String> {
    #[cfg(target_os = "macos")]
    {
        if browser.eq_ignore_ascii_case("accessibility") {
            native::request_accessibility();
        } else {
            let browser = resolve_browser(browser).ok_or_else(|| {
                "此浏览器暂不支持安全切换标签页。请选择 Safari、Chrome 或 Edge。".to_string()
            })?;
            let status = native::automation_permission(browser.id, true);
            if status == "not_running" {
                return Err(format!("请先打开 {}，再申请自动化权限。", browser.name));
            }
            if status != "granted" {
                return Err(
                    "尚未获得浏览器自动化权限，请在系统设置 → 隐私与安全性 → 自动化中检查。".into(),
                );
            }
        }
        Ok(health())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = browser;
        Err("此适配器仅支持 macOS。".into())
    }
}

/// Installed icons are read locally; no icon service or browser history is used.
pub fn installed_apps() -> Result<Vec<InstalledApp>, String> {
    #[cfg(target_os = "macos")]
    {
        Ok(mado::get_installed_apps(mado::InstalledAppsConfig {
            include_icon: true,
            include_app_color: false,
            icon_size: 40,
        })
        .into_iter()
        .map(|app| {
            let executable = focuser_common::process::name_for_path(&app.path);
            InstalledApp {
                protected: is_protected_identity(&app.bundle_id, &executable, &app.path),
                name: app.name,
                bundle_id: app.bundle_id,
                path: app.path,
                executable,
                icon: app.icon.and_then(|icon| icon.data_url),
            }
        })
        .collect())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("此应用列表仅支持 macOS。".into())
    }
}

#[derive(Clone, Copy)]
struct Browser {
    id: &'static str,
    name: &'static str,
    safari: bool,
}

const BROWSERS: &[Browser] = &[
    Browser {
        id: "com.apple.Safari",
        name: "Safari",
        safari: true,
    },
    Browser {
        id: "com.google.Chrome",
        name: "Chrome",
        safari: false,
    },
    Browser {
        id: "com.microsoft.edgemac",
        name: "Edge",
        safari: false,
    },
    Browser {
        id: "com.brave.Browser",
        name: "Brave",
        safari: false,
    },
    Browser {
        id: "org.chromium.Chromium",
        name: "Chromium",
        safari: false,
    },
    Browser {
        id: "com.vivaldi.Vivaldi",
        name: "Vivaldi",
        safari: false,
    },
    Browser {
        id: "company.thebrowser.Browser",
        name: "Arc",
        safari: false,
    },
    Browser {
        id: "com.operasoftware.Opera",
        name: "Opera",
        safari: false,
    },
];

fn resolve_browser(value: &str) -> Option<&'static Browser> {
    BROWSERS.iter().find(|browser| {
        browser.id.eq_ignore_ascii_case(value) || browser.name.eq_ignore_ascii_case(value)
    })
}

fn is_browser(id: &str) -> bool {
    resolve_browser(id).is_some()
        || matches!(
            id,
            "org.mozilla.firefox" | "app.zen-browser.zen" | "com.apple.SafariTechnologyPreview"
        )
}

fn is_protected_identity(bundle_id: &str, executable: &str, path: &str) -> bool {
    const IDS: &[&str] = &[
        "com.apple.finder",
        "com.apple.systempreferences",
        "com.apple.terminal",
        "com.apple.loginwindow",
        "com.apple.dock",
        "com.apple.systemuiserver",
        "com.apple.controlcenter",
        "com.apple.securityagent",
        "com.apple.notificationcenterui",
        "com.apple.activitymonitor",
        "com.openai.codex",
        "com.openai.chat",
        "com.focusgarden.app",
        "com.focus-garden.app",
        "com.focuser.app",
        "org.focusgarden.local",
        "com.googlecode.iterm2",
        "dev.warp.warp-stable",
        "com.mitchellh.ghostty",
        "net.kovidgoyal.kitty",
        "org.alacritty",
    ];
    let id = bundle_id.to_ascii_lowercase();
    IDS.contains(&id.as_str())
        || path.starts_with("/System/Library/")
        || matches!(
            executable.to_ascii_lowercase().as_str(),
            "codex"
                | "focus garden"
                | "focus-garden"
                | "focuser"
                | "terminal"
                | "finder"
                | "system settings"
                | "system preferences"
                | "loginwindow"
        )
}

#[derive(Clone, Debug, Default)]
struct Foreground {
    pid: i32,
    name: String,
    bundle_id: String,
    executable: String,
    path: String,
    title: Option<String>,
    url: Option<String>,
    regular_app: bool,
    idle_secs: f64,
}

impl Foreground {
    fn health(&self) -> ForegroundHealth {
        ForegroundHealth {
            pid: self.pid,
            name: self.name.clone(),
            bundle_id: self.bundle_id.clone(),
            regular_app: self.regular_app,
            protected: self.protected(),
            protection_reason: self.protection_reason().map(str::to_string),
        }
    }

    fn protection_reason(&self) -> Option<&'static str> {
        if self.pid <= 4 {
            Some("系统进程")
        } else if self.pid as u32 == std::process::id() {
            Some("专注花园自身")
        } else if !self.regular_app {
            Some("后台进程或系统辅助界面")
        } else if is_protected_identity(&self.bundle_id, &self.executable, &self.path) {
            Some("保留的系统恢复或工作应用")
        } else {
            None
        }
    }

    fn protected(&self) -> bool {
        self.protection_reason().is_some()
    }

    fn same_target(&self, other: &Self) -> bool {
        self.pid == other.pid && self.bundle_id == other.bundle_id && self.path == other.path
    }
}

#[derive(Default)]
struct Policy {
    lists: Vec<BlockList>,
    whitelist: HashMap<String, bool>,
    allowance_apps: Vec<String>,
    allowance_domains: Vec<String>,
    blocked_apps: Vec<String>,
    blocked_domains: Vec<String>,
    has_allowances: bool,
    needs_url: bool,
    needs_title: bool,
}

impl Policy {
    fn active(&self) -> bool {
        self.has_allowances
            || self.lists.iter().any(|list| {
                list.websites.iter().any(|rule| rule.enabled)
                    || list.applications.iter().any(|rule| rule.enabled)
                    || self.whitelist.get(&list.id.to_string()) == Some(&true)
            })
    }
}

fn load_policy(state: &crate::AppState, active_id: Option<&str>) -> Result<Policy, String> {
    let mut engine = state.engine.lock().map_err(|_| "规则数据库暂时不可用。")?;
    engine.refresh().map_err(|error| error.to_string())?;
    state
        .allowance_tracker
        .rebuild_from_db(engine.db())
        .map_err(|error| error.to_string())?;
    let allowances = engine
        .db()
        .list_allowances()
        .map_err(|error| error.to_string())?;
    let mut policy = Policy {
        has_allowances: allowances.iter().any(|allowance| allowance.enabled),
        needs_url: allowances.iter().any(|allowance| {
            allowance.enabled
                && matches!(
                    allowance.target,
                    focuser_common::allowance::AllowanceMatch::Domain(_)
                )
        }),
        blocked_apps: state.allowance_tracker.blocked_apps(),
        blocked_domains: state.allowance_tracker.blocked_domains(),
        ..Policy::default()
    };
    if active_id.is_none() {
        policy.allowance_apps = state.allowance_tracker.active_allowance_apps(engine.db());
        policy.allowance_domains = state
            .allowance_tracker
            .active_allowance_domains(engine.db());
    }
    for saved in engine.block_lists() {
        let mut list = saved.clone();
        if active_id == Some(list.id.to_string().as_str()) {
            // The session overlay is a transient copy. It cannot disable a
            // user's saved list or destroy its weekly schedule on completion.
            list.enabled = true;
            list.schedule = None;
        }
        if !list.is_effectively_active() {
            continue;
        }
        let whitelist = engine
            .db()
            .get_setting(&format!("garden_app_mode:{}", list.id))
            .map_err(|error| error.to_string())?
            .as_deref()
            == Some("whitelist");
        policy.whitelist.insert(list.id.to_string(), whitelist);
        policy.needs_url |= list.websites.iter().any(|rule| rule.enabled);
        policy.needs_title |= list
            .applications
            .iter()
            .any(|rule| rule.enabled && matches!(rule.match_type, AppMatchType::WindowTitle(_)));
        policy.lists.push(list);
    }
    Ok(policy)
}

fn matches_app(rule: &focuser_common::types::AppRule, app: &Foreground) -> bool {
    if !rule.enabled {
        return false;
    }
    match &rule.match_type {
        AppMatchType::BundleId(id) => id.eq_ignore_ascii_case(&app.bundle_id),
        AppMatchType::ExecutablePath(path) if path.ends_with(".app") => {
            app.path.starts_with(&format!("{path}/Contents/"))
        }
        _ => rule.matches_process(&app.executable, Some(&app.path), app.title.as_deref()),
    }
}

fn web_url(raw: &str) -> Option<Url> {
    let url = Url::parse(raw).ok()?;
    (matches!(url.scheme(), "http" | "https") && url.host_str().is_some()).then_some(url)
}

/// Match paths on their own URL components. Searching the complete URL for a
/// path would incorrectly block an allowed site's query string or a host suffix.
fn path_matches(pattern: &str, url: &Url) -> bool {
    let pattern = pattern.trim();
    let path;
    let required_query;
    if pattern.starts_with('/') {
        let (left, right) = pattern
            .split_once('?')
            .map_or((pattern, None), |(a, b)| (a, Some(b)));
        path = left.to_string();
        required_query = right.map(str::to_string);
    } else {
        let raw = if pattern.contains("://") {
            pattern.to_string()
        } else {
            format!("https://{pattern}")
        };
        let Some(rule_url) = web_url(&raw) else {
            return false;
        };
        if !host_matches(
            rule_url.host_str().unwrap_or_default(),
            url.host_str().unwrap_or_default(),
        ) {
            return false;
        }
        path = rule_url.path().to_string();
        required_query = rule_url.query().map(str::to_string);
    }
    if path.is_empty() {
        return false;
    }
    let candidate = url.path();
    let same_path = candidate == path
        || candidate
            .strip_prefix(&path)
            .is_some_and(|tail| path.ends_with('/') || tail.starts_with('/'));
    same_path
        && required_query
            .as_deref()
            .is_none_or(|query| url.query() == Some(query))
}

fn wildcard_url_matches(pattern: &str, url: &Url) -> bool {
    let pattern = pattern.trim();
    let pattern = pattern.split_once("://").map_or(pattern, |(_, rest)| rest);
    if let Some((host, path)) = pattern.split_once('/') {
        let (path, query) = path
            .split_once('?')
            .map_or((path, None), |(path, query)| (path, Some(query)));
        wildcard_matches(host, url.host_str().unwrap_or_default())
            && url_component_glob(&format!("/{path}"), url.path())
            && query.is_none_or(|pattern| {
                url.query()
                    .is_some_and(|query| url_component_glob(pattern, query))
            })
    } else {
        wildcard_matches(pattern, url.host_str().unwrap_or_default())
    }
}

/// URL wildcards span slashes; filesystem glob stars do not. Query separators
/// are parsed above, so '?' cannot accidentally permit a different video ID.
fn url_component_glob(pattern: &str, value: &str) -> bool {
    let pattern: Vec<char> = pattern.chars().collect();
    let value: Vec<char> = value.chars().collect();
    let (mut p, mut v, mut star, mut retry) = (0, 0, None, 0);
    while v < value.len() {
        if p < pattern.len() && pattern[p] == '*' {
            star = Some(p);
            p += 1;
            retry = v;
        } else if p < pattern.len() && pattern[p] == value[v] {
            p += 1;
            v += 1;
        } else if let Some(index) = star {
            retry += 1;
            v = retry;
            p = index + 1;
        } else {
            return false;
        }
    }
    while p < pattern.len() && pattern[p] == '*' {
        p += 1;
    }
    p == pattern.len()
}

fn list_blocks_url(list: &BlockList, url: &Url) -> bool {
    let host = url.host_str().unwrap_or_default();
    let excepted = list.exceptions.iter().any(|exception| {
        exception.enabled
            && match &exception.exception_type {
                ExceptionType::Domain(value) => host_matches(value, host),
                ExceptionType::Wildcard(value) => wildcard_url_matches(value, url),
                ExceptionType::LocalFiles => false,
            }
    });
    if excepted {
        return false;
    }
    list.websites.iter().any(|rule| {
        rule.enabled
            && match &rule.match_type {
                WebsiteMatchType::Domain(value) => host_matches(value, host),
                WebsiteMatchType::Wildcard(value) => wildcard_url_matches(value, url),
                WebsiteMatchType::UrlPath(value) => path_matches(value, url),
                WebsiteMatchType::Keyword(value) => {
                    !value.trim().is_empty() && rule.matches_url(url.as_str())
                }
                WebsiteMatchType::EntireInternet => true,
            }
    })
}

fn decision(policy: &Policy, front: &Foreground) -> Option<BlockNotice> {
    if front.protected() {
        return None;
    }
    let app_exempt = policy
        .allowance_apps
        .iter()
        .any(|name| name.eq_ignore_ascii_case(&front.executable));
    if !app_exempt {
        for list in &policy.lists {
            let matched = list
                .applications
                .iter()
                .any(|rule| matches_app(rule, front));
            let whitelist = policy.whitelist.get(&list.id.to_string()) == Some(&true);
            if (whitelist && !matched) || (!whitelist && matched) {
                return Some(notice("app", &front.name, &list.name));
            }
        }
    }
    if policy
        .blocked_apps
        .iter()
        .any(|name| name.eq_ignore_ascii_case(&front.executable))
    {
        return Some(notice("app", &front.name, "每日应用额度"));
    }
    let url = web_url(front.url.as_deref()?)?;
    let host = canonical_host(url.host_str()?);
    if any_host_matches(&policy.blocked_domains, &host) {
        return Some(notice("website", &host, "每日网站额度"));
    }
    if !any_host_matches(&policy.allowance_domains, &host) {
        for list in &policy.lists {
            if list_blocks_url(list, &url) {
                return Some(notice("website", &host, &list.name));
            }
        }
    }
    None
}

fn notice(kind: &str, target: &str, list_name: &str) -> BlockNotice {
    BlockNotice {
        kind: kind.into(),
        target: target.into(),
        list_name: list_name.into(),
        confirmed: false,
        message: "这次分心已经接住了。回到手上的一小步，让花园继续生长。".into(),
    }
}

#[derive(Default)]
struct UsageClock {
    previous: Option<(Instant, Foreground)>,
    app_remainder: Duration,
    domain_remainder: Duration,
}

#[derive(Debug, Default, PartialEq, Eq)]
struct UsageSeconds {
    app: u32,
    domain: u32,
}

fn foreground_host(front: &Foreground) -> Option<String> {
    front
        .url
        .as_deref()
        .and_then(web_url)
        .and_then(|url| url.host_str().map(canonical_host))
}

fn observed_seconds(remainder: &mut Duration, delta: Duration, same_scope: bool) -> u32 {
    if !same_scope {
        *remainder = Duration::ZERO;
        return 0;
    }
    *remainder += delta;
    let seconds = remainder.as_secs().min(3) as u32;
    *remainder = remainder.saturating_sub(Duration::from_secs(u64::from(seconds)));
    seconds
}

impl UsageClock {
    fn sample(&mut self, now: Instant, current: &Foreground) -> UsageSeconds {
        let Some((previous_at, previous)) = self.previous.replace((now, current.clone())) else {
            return UsageSeconds::default();
        };
        let delta = now.saturating_duration_since(previous_at);
        // App time continues across tab navigation. Site time continues across
        // URLs on that hostname, but cannot be charged to a newly visited site.
        // Both clocks reject sleep, long sampling gaps and user-idle intervals.
        if delta > Duration::from_secs(3) || current.idle_secs >= 60.0 || previous.idle_secs >= 60.0
        {
            self.app_remainder = Duration::ZERO;
            self.domain_remainder = Duration::ZERO;
            return UsageSeconds::default();
        }
        let previous_host = foreground_host(&previous);
        let current_host = foreground_host(current);
        UsageSeconds {
            app: observed_seconds(
                &mut self.app_remainder,
                delta,
                previous.same_target(current),
            ),
            domain: observed_seconds(
                &mut self.domain_remainder,
                delta,
                current_host.is_some() && current_host == previous_host,
            ),
        }
    }
}

fn charge_usage(
    state: &crate::AppState,
    front: &Foreground,
    seconds: UsageSeconds,
) -> Result<(), String> {
    if (seconds.app == 0 && seconds.domain == 0) || front.protected() {
        return Ok(());
    }
    let engine = state.engine.lock().map_err(|_| "额度数据库暂时不可用。")?;
    for (increment, hostname, app_exe, source) in [
        (
            seconds.app,
            None,
            Some(front.executable.clone()),
            "focus-garden-mac-app",
        ),
        (
            seconds.domain,
            foreground_host(front),
            None,
            "focus-garden-mac-domain",
        ),
    ] {
        if increment == 0 {
            continue;
        }
        let tick = AllowanceTick {
            hostname,
            app_exe,
            active: true,
            source: source.into(),
            increment_secs: Some(increment),
        };
        state
            .allowance_tracker
            .ingest_tick(engine.db(), &tick)
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

enum AttemptError {
    Rejected(String),
    Uncertain(String),
}

#[cfg(target_os = "macos")]
#[derive(Default)]
struct DispatchPermit(std::sync::atomic::AtomicU8);

#[cfg(target_os = "macos")]
impl DispatchPermit {
    fn claim(&self) -> bool {
        self.0
            .compare_exchange(
                0,
                1,
                std::sync::atomic::Ordering::SeqCst,
                std::sync::atomic::Ordering::SeqCst,
            )
            .is_ok()
    }

    fn cancel_before_dispatch(&self) -> bool {
        self.0
            .compare_exchange(
                0,
                2,
                std::sync::atomic::Ordering::SeqCst,
                std::sync::atomic::Ordering::SeqCst,
            )
            .is_ok()
    }
}

impl From<String> for AttemptError {
    fn from(message: String) -> Self {
        Self::Rejected(message)
    }
}

impl From<&str> for AttemptError {
    fn from(message: &str) -> Self {
        Self::Rejected(message.into())
    }
}

impl AttemptError {
    fn message(&self) -> &str {
        match self {
            Self::Rejected(message) | Self::Uncertain(message) => message,
        }
    }
}

fn retain_dispatch(result: &Result<bool, AttemptError>) -> bool {
    matches!(result, Err(AttemptError::Uncertain(_)))
}

#[cfg(target_os = "macos")]
enum HideDispatch {
    NotSent,
    Sent { system_reported_success: bool },
}

#[cfg(target_os = "macos")]
fn confirm_dispatched_hide(
    dispatch: HideDispatch,
    mut observe_hidden: impl FnMut() -> Result<bool, AttemptError>,
) -> Result<bool, AttemptError> {
    let HideDispatch::Sent {
        system_reported_success,
    } = dispatch
    else {
        return Ok(false);
    };
    // macOS can return NO after actually hiding the app. Once hide was called,
    // only fresh observations establish success. This callback cannot resend.
    for _ in 0..5 {
        if observe_hidden()? {
            return Ok(true);
        }
    }
    Err(AttemptError::Uncertain(
        if system_reported_success {
            "应用隐藏结果未确认，未计入拦截次数。"
        } else {
            "系统未确认应用隐藏，结果未知；未重复执行或计入拦截次数。"
        }
        .into(),
    ))
}

/// How many readbacks (about 100 ms apart) to wait for a polite quit.
#[cfg(target_os = "macos")]
const QUIT_POLLS: u32 = 25;

/// A polite quit has succeeded only once the process is observed gone.
#[cfg(target_os = "macos")]
fn confirm_dispatched_quit(
    dispatch: HideDispatch,
    mut observe_gone: impl FnMut() -> Result<bool, AttemptError>,
) -> Result<QuitOutcome, AttemptError> {
    if matches!(dispatch, HideDispatch::NotSent) {
        return Ok(QuitOutcome::NotSent);
    }
    for _ in 0..QUIT_POLLS {
        if observe_gone()? {
            return Ok(QuitOutcome::Quit);
        }
    }
    Ok(QuitOutcome::StillRunning)
}

#[cfg(target_os = "macos")]
#[derive(Debug, PartialEq, Eq)]
enum QuitOutcome {
    NotSent,
    Quit,
    /// Still running (e.g. it is asking to save). The caller hides it instead.
    StillRunning,
}

/// Root starts this once, after constructing its independent garden ledger.
/// The worker acquires garden and engine locks in separate scopes, never nested.
pub fn start(app: tauri::AppHandle, state: Arc<crate::AppState>, garden: crate::GardenState) {
    #[cfg(target_os = "macos")]
    std::thread::spawn(move || {
        let page = match prepare_block_page(&app) {
            Ok(page) => page,
            Err(error) => {
                update_health(|health| health.last_error = Some(error));
                return;
            }
        };
        let mut usage = UsageClock::default();
        // A dispatched target is single-use until a different foreground state
        // is observed. A script/readback timeout must not replay a mutation.
        let mut dispatched: Option<(i32, String)> = None;
        let mut last_action_error: Option<((i32, String), String)> = None;
        loop {
            let active_id = garden
                .lock()
                .ok()
                .and_then(|service| service.active_work_list_id());
            let policy = match load_policy(&state, active_id.as_deref()) {
                Ok(policy) => policy,
                Err(error) => {
                    update_health(|health| {
                        health.monitoring = false;
                        health.last_error = Some(error);
                    });
                    std::thread::sleep(Duration::from_secs(5));
                    continue;
                }
            };
            update_health(|health| {
                health.rules_active = policy.active();
                health.monitoring = policy.active();
            });
            if !policy.active() {
                usage = UsageClock::default();
                dispatched = None;
                last_action_error = None;
                update_health(|health| {
                    health.front_browser = None;
                    health.front_url_available = false;
                    health.front_app = None;
                    health.matched_rule = None;
                    health.last_error = None;
                });
                std::thread::sleep(Duration::from_secs(5));
                continue;
            }
            let front = match native::foreground(&app, policy.needs_url, policy.needs_title) {
                Ok(front) => front,
                Err(error) => {
                    usage = UsageClock::default();
                    update_health(|health| {
                        health.monitoring = false;
                        health.front_app = None;
                        health.matched_rule = None;
                        health.last_error = Some(error);
                    });
                    std::thread::sleep(Duration::from_secs(1));
                    continue;
                }
            };
            let key = (front.pid, front.url.clone().unwrap_or_default());
            if dispatched.as_ref().is_some_and(|old| old != &key) {
                dispatched = None;
            }
            if last_action_error
                .as_ref()
                .is_some_and(|(old, _)| old != &key)
            {
                last_action_error = None;
            }
            let seconds = usage.sample(Instant::now(), &front);
            let usage_error = if policy.has_allowances {
                charge_usage(&state, &front, seconds).err()
            } else {
                None
            };
            // Re-read ledger after this second's debit, so the last quota
            // second blocks now rather than granting an extra polling period.
            let latest_active_id = garden
                .lock()
                .ok()
                .and_then(|service| service.active_work_list_id());
            let policy = match load_policy(&state, latest_active_id.as_deref()) {
                Ok(policy) => policy,
                Err(error) => {
                    update_health(|health| {
                        health.monitoring = false;
                        health.last_error = Some(error);
                    });
                    std::thread::sleep(Duration::from_secs(1));
                    continue;
                }
            };
            let block_decision = decision(&policy, &front);
            update_health(|health| {
                health.accessibility_granted = mado::is_accessibility_trusted();
                health.front_app = Some(front.health());
                health.matched_rule = block_decision.as_ref().map(|event| event.list_name.clone());
                health.front_browser = is_browser(&front.bundle_id).then(|| front.name.clone());
                health.front_url_available = front.url.as_deref().and_then(web_url).is_some();
                health.last_error = if policy.needs_url
                    && is_browser(&front.bundle_id)
                    && !health.accessibility_granted
                {
                    Some("网站限制需要辅助功能权限；当前尚未生效。".into())
                } else if policy.needs_title && !health.accessibility_granted {
                    Some("窗口标题规则需要辅助功能权限；当前只能限制已指定的应用。".into())
                } else if policy.needs_url && is_browser(&front.bundle_id) && front.url.is_none() {
                    Some("当前浏览器未提供可读取的网址；此标签的网站限制尚未验证。".into())
                } else {
                    usage_error.clone().or_else(|| {
                        last_action_error
                            .as_ref()
                            .map(|(_, message)| message.clone())
                    })
                };
            });
            if let Some(mut event) = block_decision
                && dispatched.as_ref() != Some(&key)
            {
                dispatched = Some(key.clone());
                let result = if event.kind == "app" {
                    native::quit_app(&app, &front)
                } else {
                    native::redirect_browser(&app, &front, &blocked_url(&page, &front, &event))
                };
                if !retain_dispatch(&result) {
                    dispatched = None;
                }
                match result {
                    Ok(true) => {
                        last_action_error = None;
                        event.confirmed = true;
                        let stat_target = if event.kind == "app" {
                            format!("app:{}", front.bundle_id)
                        } else {
                            format!("website:{}", event.target)
                        };
                        if let Ok(engine) = state.engine.lock() {
                            let _ = engine.record_blocked(&stat_target);
                        }
                        if let Ok(mut service) = garden.lock() {
                            let _ = service.record_block(&event.kind);
                        }
                        update_health(|health| {
                            if event.kind == "app" {
                                health.blocked_apps += 1;
                            } else {
                                health.blocked_websites += 1;
                            }
                            health.last_error = usage_error.clone();
                        });
                        let _ = app.emit("garden-blocked", &event);
                        if event.kind == "app"
                            && let Some(window) = app.get_webview_window("main")
                        {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    Ok(false) => {}
                    Err(error) => {
                        let message = error.message().to_string();
                        let previous_notice = last_action_error
                            .as_ref()
                            .is_some_and(|(old, prior)| old == &key && prior == &message);
                        last_action_error = Some((key, message.clone()));
                        update_health(|health| health.last_error = Some(message.clone()));
                        event.message = message;
                        if previous_notice {
                            std::thread::sleep(Duration::from_secs(1));
                            continue;
                        }
                        let _ = app.emit("garden-blocked", &event);
                        // No browser hiding and no false blocked count. The
                        // main window serves only as a permission notice.
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                }
            }
            std::thread::sleep(Duration::from_secs(1));
        }
    });
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, state, garden);
    }
}

fn prepare_block_page(_app: &tauri::AppHandle) -> Result<Url, String> {
    let directory = crate::data_dir();
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let path = directory.join("focus-garden-blocked.html");
    std::fs::write(&path, include_str!("mac_guard_blocked.html"))
        .map_err(|error| error.to_string())?;
    Url::from_file_path(path).map_err(|_| "无法生成本地提示页地址。".into())
}

fn blocked_url(page: &Url, front: &Foreground, event: &BlockNotice) -> String {
    let fragment = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("original", front.url.as_deref().unwrap_or_default())
        .append_pair("target", &event.target)
        .append_pair("list", &event.list_name)
        .finish();
    let mut url = page.clone();
    url.set_fragment(Some(&fragment));
    url.into()
}

#[cfg(target_os = "macos")]
mod native {
    use super::*;
    use objc2_app_kit::{NSApplicationActivationPolicy, NSRunningApplication};
    use objc2_core_graphics::{CGEventSource, CGEventSourceStateID, CGEventType};
    use std::ffi::c_void;
    use std::process::{Command, Stdio};

    unsafe extern "C" {
        fn pthread_main_np() -> std::ffi::c_int;
    }

    /// AppKit's changing application properties are refreshed by the main run
    /// loop. All observations, including pre-dispatch checks, use that same
    /// thread. This schedules only reads: a timeout can never leave a queued
    /// hide or tab change that fires later against an unobserved target.
    fn query_on_main<T: Send + 'static>(
        app: &tauri::AppHandle,
        query: impl FnOnce() -> Result<T, String> + Send + 'static,
    ) -> Result<T, String> {
        if unsafe { pthread_main_np() } != 0 {
            return query();
        }
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        app.run_on_main_thread(move || {
            let _ = sender.send(query());
        })
        .map_err(|_| "无法在应用主线程读取前台状态。".to_string())?;
        receiver
            .recv_timeout(Duration::from_secs(2))
            .map_err(|_| "前台状态读取超时，本次未执行限制。".to_string())?
    }

    pub fn foreground(
        app: &tauri::AppHandle,
        needs_url: bool,
        needs_title: bool,
    ) -> Result<Foreground, String> {
        query_on_main(app, move || foreground_on_main(needs_url, needs_title))
    }

    fn foreground_on_main(needs_url: bool, needs_title: bool) -> Result<Foreground, String> {
        let app = mado::get_active_app().map_err(|_| "暂时无法读取前台应用。".to_string())?;
        let path = app.process_path.unwrap_or_default();
        let mut front = Foreground {
            pid: app.pid,
            name: app.name.unwrap_or_else(|| "应用".into()),
            bundle_id: app.bundle_id.unwrap_or_default(),
            executable: std::path::Path::new(&path)
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default(),
            path,
            ..Foreground::default()
        };
        front.regular_app =
            NSRunningApplication::runningApplicationWithProcessIdentifier(front.pid).is_some_and(
                |running| running.activationPolicy() == NSApplicationActivationPolicy::Regular,
            );
        front.idle_secs = CGEventSource::seconds_since_last_event_type(
            CGEventSourceStateID::CombinedSessionState,
            CGEventType(u32::MAX),
        );
        if !front.idle_secs.is_finite() || front.idle_secs < 0.0 {
            front.idle_secs = 60.0;
        }
        if !front.protected()
            && (needs_title || (needs_url && is_browser(&front.bundle_id)))
            && mado::is_accessibility_trusted()
            && let Ok(window) = mado::get_active_window_with_config(mado::QueryConfig {
                include_browser_info: needs_url,
                include_website_info: false,
                ..mado::QueryConfig::default()
            })
            && window.app.pid == front.pid
        {
            front.title = window.title;
            front.url = window.browser.and_then(|browser| browser.url);
        }
        Ok(front)
    }

    pub fn hide_app(
        handle: &tauri::AppHandle,
        expected: &Foreground,
    ) -> Result<bool, AttemptError> {
        if unsafe { pthread_main_np() } != 0 {
            return Err("应用限制需要后台调度，本次未执行。".into());
        }
        // The worker holds no engine/garden lock while waiting for AppKit.
        // Cancellation happens before the queued callback claims this permit;
        // an unknown post-dispatch outcome is never treated as retryable.
        let expected = expected.clone();
        let permit = Arc::new(DispatchPermit::default());
        let ticket = permit.clone();
        let target = expected.clone();
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        handle
            .run_on_main_thread(move || {
                if ticket.claim() {
                    let _ = sender.send(hide_once_on_main(&target));
                }
            })
            .map_err(|_| "无法在应用主线程执行隐藏。".to_string())?;
        let dispatch = match receiver.recv_timeout(Duration::from_secs(2)) {
            Ok(result) => result?,
            Err(_) if permit.cancel_before_dispatch() => {
                return Err("应用主线程繁忙，本次尚未执行隐藏。".into());
            }
            Err(_) => {
                return Err(AttemptError::Uncertain(
                    "应用隐藏响应超时，结果未知。".into(),
                ));
            }
        };
        // A later main-loop turn refreshes isHidden. Never sleep in an AppKit
        // callback: doing so would prevent the very update we need to verify.
        confirm_dispatched_hide(dispatch, || {
            std::thread::sleep(Duration::from_millis(40));
            let target = expected.clone();
            query_on_main(handle, move || {
                Ok(
                    NSRunningApplication::runningApplicationWithProcessIdentifier(target.pid)
                        .is_some_and(|running| {
                            running
                                .bundleIdentifier()
                                .is_some_and(|id| id.to_string() == target.bundle_id)
                                && running.isHidden()
                        }),
                )
            })
            .map_err(AttemptError::Uncertain)
        })
    }

    /// Asks the blocked app to quit like ⌘Q, so audio and video stop too.
    /// If it is still running afterwards (for example it shows a save dialog),
    /// it is hidden instead; nothing is ever force-killed.
    pub fn quit_app(
        handle: &tauri::AppHandle,
        expected: &Foreground,
    ) -> Result<bool, AttemptError> {
        if unsafe { pthread_main_np() } != 0 {
            return Err("应用限制需要后台调度，本次未执行。".into());
        }
        let permit = Arc::new(DispatchPermit::default());
        let ticket = permit.clone();
        let target = expected.clone();
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        handle
            .run_on_main_thread(move || {
                if ticket.claim() {
                    let _ = sender.send(quit_once_on_main(&target));
                }
            })
            .map_err(|_| "无法在应用主线程执行退出。".to_string())?;
        let dispatch = match receiver.recv_timeout(Duration::from_secs(2)) {
            Ok(result) => result?,
            Err(_) if permit.cancel_before_dispatch() => {
                return Err("应用主线程繁忙，本次尚未执行退出。".into());
            }
            Err(_) => {
                return Err(AttemptError::Uncertain(
                    "应用退出响应超时，结果未知。".into(),
                ));
            }
        };
        let outcome = confirm_dispatched_quit(dispatch, || {
            std::thread::sleep(Duration::from_millis(100));
            let target = expected.clone();
            query_on_main(handle, move || {
                Ok(
                    NSRunningApplication::runningApplicationWithProcessIdentifier(target.pid)
                        .is_none_or(|running| running.isTerminated()),
                )
            })
            .map_err(AttemptError::Uncertain)
        })?;
        match outcome {
            QuitOutcome::NotSent => Ok(false),
            QuitOutcome::Quit => Ok(true),
            QuitOutcome::StillRunning => hide_app(handle, expected),
        }
    }

    fn quit_once_on_main(expected: &Foreground) -> Result<HideDispatch, AttemptError> {
        let fresh = foreground_on_main(false, false)?;
        if !fresh.same_target(expected) || fresh.protected() {
            return Ok(HideDispatch::NotSent);
        }
        let Some(app) = NSRunningApplication::runningApplicationWithProcessIdentifier(expected.pid)
        else {
            return Ok(HideDispatch::NotSent);
        };
        if !app.isActive() || app.isTerminated() {
            return Ok(HideDispatch::NotSent);
        }
        Ok(HideDispatch::Sent {
            system_reported_success: app.terminate(),
        })
    }

    fn hide_once_on_main(expected: &Foreground) -> Result<HideDispatch, AttemptError> {
        let fresh = foreground_on_main(false, false)?;
        if !fresh.same_target(expected) || fresh.protected() {
            return Ok(HideDispatch::NotSent);
        }
        let Some(app) = NSRunningApplication::runningApplicationWithProcessIdentifier(expected.pid)
        else {
            return Ok(HideDispatch::NotSent);
        };
        if !app.isActive() || app.isHidden() {
            return Ok(HideDispatch::NotSent);
        }
        Ok(HideDispatch::Sent {
            system_reported_success: app.hide(),
        })
    }

    pub fn redirect_browser(
        handle: &tauri::AppHandle,
        expected: &Foreground,
        destination: &str,
    ) -> Result<bool, AttemptError> {
        if unsafe { pthread_main_np() } != 0 {
            return Err("网站限制需要后台调度，本次未执行。".into());
        }
        let browser = resolve_browser(&expected.bundle_id).ok_or_else(|| {
            "此浏览器暂不支持标签页限制；请使用 Safari、Chrome 或 Edge。".to_string()
        })?;
        if automation_permission(browser.id, false) != "granted" {
            return Err(format!(
                "尚未获得 {} 的自动化权限，网站未被拦截。请到设置中主动授权。",
                browser.name
            )
            .into());
        }
        let fresh = foreground(handle, true, false)?;
        if !fresh.same_target(expected) || fresh.url != expected.url {
            return Ok(false);
        }
        let Some(original) = expected.url.as_deref() else {
            return Ok(false);
        };
        // The script is a fixed template with only a hard-coded browser ID.
        // Untrusted URLs are argv values, never script or shell source.
        let script = browser_script(browser);
        let mut child = Command::new("/usr/bin/osascript")
            .args(["-e", &script, "--", original, destination])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| "无法调用浏览器的标签页接口。".to_string())?;
        let started = Instant::now();
        loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    use std::io::Read;
                    let mut output = String::new();
                    if let Some(mut stdout) = child.stdout.take() {
                        let _ = stdout.read_to_string(&mut output);
                    }
                    if !status.success() {
                        return Err(AttemptError::Uncertain(
                            "浏览器未确认标签页切换，未计入拦截次数。请检查自动化权限。".into(),
                        ));
                    }
                    return match output.trim() {
                        "confirmed" => Ok(true),
                        "stale" | "no_window" => Ok(false),
                        _ => Err(AttemptError::Uncertain(
                            "标签页切换结果尚未确认，未计入拦截次数。".into(),
                        )),
                    };
                }
                Ok(None) if started.elapsed() < Duration::from_secs(3) => {
                    std::thread::sleep(Duration::from_millis(30))
                }
                _ => {
                    // Kill only our timed-out helper, never the user's browser.
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(AttemptError::Uncertain(
                        "浏览器响应超时；切换结果未知，本次不重复执行也不计数。".into(),
                    ));
                }
            }
        }
    }

    fn browser_script(browser: &Browser) -> String {
        let tab = if browser.safari {
            "current tab of front window"
        } else {
            "active tab of front window"
        };
        format!(
            r#"on run argv
  set originalURL to item 1 of argv
  set destinationURL to item 2 of argv
  tell application id "{}"
    if frontmost is false then return "stale"
    if (count of windows) is 0 then return "no_window"
    set targetTab to {}
    if (URL of targetTab as text) is not originalURL then return "stale"
    set URL of targetTab to destinationURL
    repeat 10 times
      if (URL of targetTab as text) is destinationURL then return "confirmed"
      delay 0.08
    end repeat
    return "uncertain"
  end tell
end run"#,
            browser.id, tab
        )
    }

    // Apple public APIs, with owned descriptors always released. Read-only
    // checks pass ask=false; only the explicit request command passes true.
    // Apple's AEDataModel.h uses #pragma pack(push, 2), including on arm64.
    #[repr(C, packed(2))]
    struct AEDesc {
        descriptor_type: u32,
        data_handle: *mut c_void,
    }

    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        fn AECreateDesc(kind: u32, bytes: *const c_void, size: isize, result: *mut AEDesc) -> i16;
        fn AEDisposeDesc(descriptor: *mut AEDesc) -> i16;
        fn AEDeterminePermissionToAutomateTarget(
            target: *const AEDesc,
            event_class: u32,
            event_id: u32,
            ask: u8,
        ) -> i32;
        fn AXIsProcessTrustedWithOptions(options: *const c_void) -> u8;
        static kAXTrustedCheckOptionPrompt: *const c_void;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFDictionaryCreate(
            allocator: *const c_void,
            keys: *const *const c_void,
            values: *const *const c_void,
            count: isize,
            key_callbacks: *const c_void,
            value_callbacks: *const c_void,
        ) -> *const c_void;
        fn CFRelease(value: *const c_void);
        static kCFBooleanTrue: *const c_void;
    }

    pub fn automation_permission(bundle: &str, ask: bool) -> &'static str {
        let mut descriptor = AEDesc {
            descriptor_type: 0,
            data_handle: std::ptr::null_mut(),
        };
        // SAFETY: bundle bytes outlive AECreateDesc, which copies them. The
        // valid descriptor is disposed exactly once after the permission call.
        unsafe {
            if AECreateDesc(
                u32::from_be_bytes(*b"bund"),
                bundle.as_ptr().cast(),
                bundle.len() as isize,
                &mut descriptor,
            ) != 0
            {
                return "unavailable";
            }
            let status = AEDeterminePermissionToAutomateTarget(
                &descriptor,
                u32::from_be_bytes(*b"****"),
                u32::from_be_bytes(*b"****"),
                u8::from(ask),
            );
            let _ = AEDisposeDesc(&mut descriptor);
            match status {
                0 => "granted",
                -1743 => "denied",
                -1744 => "not_requested",
                -600 => "not_running",
                _ => "unavailable",
            }
        }
    }

    pub fn request_accessibility() {
        // SAFETY: the dictionary borrows immortal system constants, remains
        // valid for the synchronous call and is then released exactly once.
        unsafe {
            let key = kAXTrustedCheckOptionPrompt;
            let value = kCFBooleanTrue;
            let options = CFDictionaryCreate(
                std::ptr::null(),
                &key,
                &value,
                1,
                std::ptr::null(),
                std::ptr::null(),
            );
            if !options.is_null() {
                let _ = AXIsProcessTrustedWithOptions(options);
                CFRelease(options);
            }
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn apple_event_descriptor_matches_sdk_two_byte_packing() {
            assert_eq!(
                std::mem::size_of::<AEDesc>(),
                4 + std::mem::size_of::<*mut c_void>()
            );
            assert_eq!(std::mem::align_of::<AEDesc>(), 2);
        }

        #[test]
        fn permission_probe_does_not_launch_an_unknown_application() {
            // Read-only Apple API check against an intentionally nonexistent
            // target. ask=false cannot display a consent dialog or launch it.
            assert_eq!(
                automation_permission("org.focusgarden.nonexistent-permission-fixture", false),
                "not_running"
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use focuser_common::types::{AppRule, ExceptionRule, WebsiteRule};

    fn front() -> Foreground {
        Foreground {
            pid: 700_000,
            name: "Test App".into(),
            bundle_id: "org.focusgarden.test".into(),
            executable: "Test".into(),
            path: "/Applications/Test.app/Contents/MacOS/Test".into(),
            regular_app: true,
            ..Foreground::default()
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn hide_false_return_still_confirms_observed_hidden_without_resending() {
        let mut reads = 0;
        let result = confirm_dispatched_hide(
            HideDispatch::Sent {
                system_reported_success: false,
            },
            || {
                reads += 1;
                Ok(reads == 3)
            },
        );
        assert!(matches!(result, Ok(true)));
        assert_eq!(reads, 3);
        assert!(!retain_dispatch(&result));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn unconfirmed_hide_remains_single_use_regardless_of_system_return() {
        for system_reported_success in [false, true] {
            let mut reads = 0;
            let result = confirm_dispatched_hide(
                HideDispatch::Sent {
                    system_reported_success,
                },
                || {
                    reads += 1;
                    Ok(false)
                },
            );
            assert_eq!(reads, 5);
            assert!(retain_dispatch(&result));
        }
        let untouched = confirm_dispatched_hide(HideDispatch::NotSent, || {
            panic!("a pre-dispatch rejection must not enter confirmation")
        });
        assert!(matches!(untouched, Ok(false)));
        assert!(!retain_dispatch(&untouched));
        let read_error = confirm_dispatched_hide(
            HideDispatch::Sent {
                system_reported_success: false,
            },
            || Err(AttemptError::Uncertain("readback timed out".into())),
        );
        assert!(retain_dispatch(&read_error));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_quit_counts_only_when_the_process_is_seen_gone() {
        let mut reads = 0;
        let quit = confirm_dispatched_quit(
            HideDispatch::Sent {
                system_reported_success: true,
            },
            || {
                reads += 1;
                Ok(reads == 4)
            },
        );
        assert!(matches!(quit, Ok(QuitOutcome::Quit)));
        let mut reads = 0;
        let stuck = confirm_dispatched_quit(
            HideDispatch::Sent {
                system_reported_success: true,
            },
            || {
                reads += 1;
                Ok(false)
            },
        );
        assert!(matches!(stuck, Ok(QuitOutcome::StillRunning)));
        assert_eq!(reads, QUIT_POLLS);
        let untouched = confirm_dispatched_quit(HideDispatch::NotSent, || {
            panic!("a pre-dispatch rejection must not enter confirmation")
        });
        assert!(matches!(untouched, Ok(QuitOutcome::NotSent)));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn queued_hide_can_be_cancelled_only_before_dispatch() {
        let cancelled = DispatchPermit::default();
        assert!(cancelled.cancel_before_dispatch());
        assert!(!cancelled.claim());
        let sent = DispatchPermit::default();
        assert!(sent.claim());
        assert!(!sent.cancel_before_dispatch());
        assert!(!sent.claim());
        // Race the timeout against the main-thread callback. Exactly one may
        // win; a cancelled callback cannot hide a later foreground target.
        for _ in 0..32 {
            let permit = Arc::new(DispatchPermit::default());
            let barrier = Arc::new(std::sync::Barrier::new(2));
            let worker_permit = permit.clone();
            let worker_barrier = barrier.clone();
            let worker = std::thread::spawn(move || {
                worker_barrier.wait();
                worker_permit.claim()
            });
            barrier.wait();
            let was_cancelled = permit.cancel_before_dispatch();
            let was_sent = worker.join().expect("dispatch worker");
            assert_ne!(was_cancelled, was_sent);
            assert!(!permit.claim());
        }
    }

    #[test]
    fn calculator_work_overlay_matches_and_health_explains_protection() {
        let mut calculator = Foreground {
            name: "计算器".into(),
            bundle_id: "com.apple.calculator".into(),
            executable: "Calculator".into(),
            path: "/System/Applications/Calculator.app/Contents/MacOS/Calculator".into(),
            ..front()
        };
        let mut list = BlockList::new("计算器测试");
        list.enabled = false;
        list.applications.push(AppRule {
            id: uuid::Uuid::new_v4(),
            match_type: AppMatchType::BundleId("com.apple.calculator".into()),
            enabled: true,
        });
        let db = focuser_core::Database::open_in_memory().expect("fixture db");
        db.create_block_list(&list).expect("fixture list");
        let state = crate::AppState::new_headless(focuser_core::BlockEngine::new(db).unwrap());
        let inactive = load_policy(&state, None).unwrap();
        assert!(decision(&inactive, &calculator).is_none());
        let overlay = load_policy(&state, Some(&list.id.to_string())).unwrap();
        assert_eq!(decision(&overlay, &calculator).unwrap().kind, "app");
        assert!(!calculator.health().protected);
        assert!(calculator.health().protection_reason.is_none());
        calculator.regular_app = false;
        assert!(decision(&overlay, &calculator).is_none());
        assert!(calculator.health().protected);
        assert_eq!(
            calculator.health().protection_reason.as_deref(),
            Some("后台进程或系统辅助界面")
        );
        let engine = state.engine.lock().unwrap();
        assert!(!engine.db().get_block_list(list.id).unwrap().enabled);
    }

    fn with_web(kind: WebsiteMatchType) -> BlockList {
        let mut list = BlockList::new("测试限制");
        list.websites.push(WebsiteRule {
            id: uuid::Uuid::new_v4(),
            match_type: kind,
            enabled: true,
        });
        list
    }
    fn check(list: &BlockList, url: &str) -> bool {
        list_blocks_url(list, &web_url(url).expect("fixture URL"))
    }

    #[test]
    fn domain_matches_only_real_hostname_boundaries() {
        let list = with_web(WebsiteMatchType::Domain("example.com".into()));
        assert!(check(&list, "https://sub.example.com/page"));
        assert!(!check(&list, "https://notexample.com/"));
        assert!(!check(&list, "https://allowed.test/?q=example.com"));
        assert!(!check(&list, "https://example.com@allowed.test/"));
    }
    #[test]
    fn path_rules_do_not_search_query_or_host_substrings() {
        let list = with_web(WebsiteMatchType::UrlPath("example.com/shorts".into()));
        assert!(check(&list, "https://example.com/shorts/123"));
        assert!(check(&list, "https://www.example.com/shorts?x=1"));
        assert!(!check(&list, "https://example.com/shortstuff"));
        assert!(!check(&list, "https://allowed.test/?q=example.com/shorts"));
        assert!(!check(&list, "https://notexample.com/shorts"));
        assert!(!check(&list, "https://example.com/SHORTS"));
    }
    #[test]
    fn wildcard_hosts_paths_keywords_and_exceptions_work() {
        let mut list = with_web(WebsiteMatchType::Wildcard("*.example.com/games/*".into()));
        assert!(check(&list, "https://sub.example.com/games/1"));
        assert!(!check(&list, "https://sub.example.com/work/1"));
        list.exceptions
            .push(ExceptionRule::wildcard("safe.example.com/*"));
        assert!(!check(&list, "https://safe.example.com/games/1"));
        let list = with_web(WebsiteMatchType::Keyword("games".into()));
        assert!(check(&list, "https://example.com/Games"));
    }
    #[test]
    fn per_list_exception_cannot_release_another_lists_rule() {
        let mut first = with_web(WebsiteMatchType::EntireInternet);
        first.exceptions.push(ExceptionRule::domain("example.com"));
        let second = with_web(WebsiteMatchType::Domain("example.com".into()));
        let mut foreground = front();
        foreground.url = Some("https://example.com/".into());
        let policy = Policy {
            lists: vec![first, second],
            ..Policy::default()
        };
        assert_eq!(
            decision(&policy, &foreground)
                .expect("other list blocks")
                .kind,
            "website"
        );
    }
    #[test]
    fn bundle_id_path_and_window_title_match_actual_identity() {
        let mut app = front();
        app.title = Some("A distracting game".into());
        for match_type in [
            AppMatchType::BundleId(app.bundle_id.clone()),
            AppMatchType::ExecutablePath("/Applications/Test.app".into()),
            AppMatchType::WindowTitle("distracting".into()),
        ] {
            let rule = AppRule {
                id: uuid::Uuid::new_v4(),
                match_type,
                enabled: true,
            };
            assert!(matches_app(&rule, &app));
        }
    }
    #[test]
    fn whitelist_never_blocks_essential_apps_or_background_helpers() {
        let list = BlockList::new("白名单");
        let policy = Policy {
            whitelist: [(list.id.to_string(), true)].into(),
            lists: vec![list],
            ..Policy::default()
        };
        assert!(decision(&policy, &front()).is_some());
        for id in [
            "com.apple.finder",
            "com.apple.systempreferences",
            "com.apple.Terminal",
            "com.openai.codex",
            "com.focusgarden.app",
        ] {
            let mut app = front();
            app.bundle_id = id.into();
            assert!(decision(&policy, &app).is_none());
        }
        let mut helper = front();
        helper.regular_app = false;
        assert!(decision(&policy, &helper).is_none());
    }
    #[test]
    fn allowances_release_only_their_matching_targets() {
        let list = with_web(WebsiteMatchType::EntireInternet);
        let mut app = front();
        app.url = Some("https://example.com/".into());
        let mut policy = Policy {
            lists: vec![list],
            allowance_domains: vec!["example.com".into()],
            ..Policy::default()
        };
        assert!(decision(&policy, &app).is_none());
        policy.blocked_domains.push("example.com".into());
        assert_eq!(
            decision(&policy, &app).expect("quota blocks").list_name,
            "每日网站额度"
        );
    }
    #[test]
    fn inactive_and_disabled_rules_do_not_poll() {
        let mut list = with_web(WebsiteMatchType::EntireInternet);
        list.websites[0].enabled = false;
        let policy = Policy {
            lists: vec![list],
            ..Policy::default()
        };
        assert!(!policy.active());
    }
    #[test]
    fn usage_does_not_bill_sleep_or_idle_intervals() {
        let t = Instant::now();
        let mut app = front();
        let mut clock = UsageClock::default();
        assert_eq!(clock.sample(t, &app), UsageSeconds::default());
        assert_eq!(
            clock.sample(t + Duration::from_secs(1), &app),
            UsageSeconds { app: 1, domain: 0 }
        );
        assert_eq!(
            clock.sample(t + Duration::from_secs(120), &app),
            UsageSeconds::default()
        );
        app.idle_secs = 70.0;
        assert_eq!(
            clock.sample(t + Duration::from_secs(121), &app),
            UsageSeconds::default()
        );
        app.idle_secs = 0.0;
        app.url = Some("https://example.com/".into());
        assert_eq!(
            clock.sample(t + Duration::from_secs(122), &app),
            UsageSeconds::default()
        );
    }
    #[test]
    fn subsecond_usage_accumulates_without_rounding_up() {
        let t = Instant::now();
        let app = front();
        let mut clock = UsageClock::default();
        assert_eq!(clock.sample(t, &app), UsageSeconds::default());
        assert_eq!(
            clock.sample(t + Duration::from_millis(700), &app),
            UsageSeconds::default()
        );
        assert_eq!(
            clock.sample(t + Duration::from_millis(1400), &app),
            UsageSeconds { app: 1, domain: 0 }
        );
    }
    #[test]
    fn blocked_page_encodes_untrusted_text_as_data_only() {
        let mut app = front();
        app.url = Some("https://example.com/?x=\"</script>".into());
        let event = notice("website", "example.com", "<script>alert(1)</script>");
        let result = blocked_url(
            &Url::parse("file:///tmp/owned.html").expect("fixture"),
            &app,
            &event,
        );
        assert!(!result.contains("<script>"));
        assert!(result.starts_with("file:///tmp/owned.html#"));
    }
    #[test]
    fn non_web_urls_never_trigger_website_rules() {
        for url in [
            "file:///tmp/page.html",
            "about:blank",
            "chrome://settings",
            "javascript:alert(1)",
        ] {
            assert!(web_url(url).is_none());
        }
    }

    #[test]
    fn work_overlay_ignores_schedule_without_mutating_saved_lists() {
        use focuser_common::types::{Schedule, TimeSlot};
        let db = focuser_core::Database::open_in_memory().expect("fixture db");
        let mut list = with_web(WebsiteMatchType::EntireInternet);
        list.enabled = false;
        list.schedule = Some(Schedule {
            id: uuid::Uuid::new_v4(),
            name: "不在此时段".into(),
            enabled: true,
            time_slots: vec![TimeSlot::new(
                chrono::Weekday::Mon,
                chrono::NaiveTime::MIN,
                chrono::NaiveTime::MIN,
            )],
        });
        db.create_block_list(&list).expect("fixture list");
        let id = list.id.to_string();
        let engine = focuser_core::BlockEngine::new(db).expect("fixture engine");
        let state = crate::AppState::new_headless(engine);
        assert!(!load_policy(&state, None).expect("normal plan").active());
        let overlay = load_policy(&state, Some(&id)).expect("overlay plan");
        assert!(overlay.active());
        assert!(overlay.lists[0].enabled);
        assert!(overlay.lists[0].schedule.is_none());
        let engine = state.engine.lock().expect("fixture lock");
        let saved = engine.db().get_block_list(list.id).expect("saved list");
        assert!(!saved.enabled);
        assert!(saved.schedule.is_some());
        drop(engine);
        assert!(!load_policy(&state, None).expect("after break").active());
    }

    #[test]
    fn upstream_allowance_ledger_charges_app_and_domain_then_blocks() {
        use focuser_common::allowance::{Allowance, AllowanceMatch};
        let db = focuser_core::Database::open_in_memory().expect("fixture db");
        let list = with_web(WebsiteMatchType::Domain("example.com".into()));
        db.create_block_list(&list).expect("fixture list");
        let domain = Allowance::new(AllowanceMatch::Domain("example.com".into()), 60, true);
        let app = Allowance::new(AllowanceMatch::AppExecutable("Test".into()), 60, true);
        db.create_allowance(&domain)
            .expect("fixture domain allowance");
        db.create_allowance(&app).expect("fixture app allowance");
        let state =
            crate::AppState::new_headless(focuser_core::BlockEngine::new(db).expect("engine"));
        let mut foreground = front();
        foreground.url = Some("https://example.com/".into());
        assert!(decision(&load_policy(&state, None).expect("plan"), &foreground).is_none());
        // Active focus suspends exemptions even while daily budget remains.
        assert!(
            decision(
                &load_policy(&state, Some(&list.id.to_string())).expect("work plan"),
                &foreground
            )
            .is_some()
        );
        charge_usage(
            &state,
            &foreground,
            UsageSeconds {
                app: 59,
                domain: 59,
            },
        )
        .expect("usage");
        assert!(decision(&load_policy(&state, None).expect("plan"), &foreground).is_none());
        charge_usage(&state, &foreground, UsageSeconds { app: 1, domain: 1 }).expect("last second");
        assert!(
            decision(
                &load_policy(&state, None).expect("exhausted plan"),
                &foreground
            )
            .is_some()
        );
        let engine = state.engine.lock().expect("lock");
        assert_eq!(
            engine
                .db()
                .get_allowance_used_today(domain.id)
                .expect("domain usage"),
            60
        );
        assert_eq!(
            engine
                .db()
                .get_allowance_used_today(app.id)
                .expect("app usage"),
            60
        );
    }

    #[test]
    fn arbitrary_browser_identifiers_cannot_become_applescript_source() {
        assert!(resolve_browser("com.apple.Safari\"\n do shell script \"bad\"").is_none());
        assert!(resolve_browser("Safari").is_some());
        assert!(resolve_browser("com.google.Chrome").is_some());
    }

    #[test]
    fn same_domain_navigation_bills_both_ledgers_but_cross_domain_only_bills_app() {
        use focuser_common::allowance::{Allowance, AllowanceMatch};
        let db = focuser_core::Database::open_in_memory().expect("fixture db");
        let first = Allowance::new(AllowanceMatch::Domain("example.com".into()), 60, true);
        let second = Allowance::new(AllowanceMatch::Domain("other.test".into()), 60, true);
        let app = Allowance::new(AllowanceMatch::AppExecutable("Test".into()), 60, true);
        for allowance in [&first, &second, &app] {
            db.create_allowance(allowance).expect("fixture allowance");
        }
        let state =
            crate::AppState::new_headless(focuser_core::BlockEngine::new(db).expect("engine"));
        let mut front = front();
        let mut clock = UsageClock::default();
        let t = Instant::now();
        front.url = Some("https://example.com/page-one".into());
        charge_usage(&state, &front, clock.sample(t, &front)).expect("initial sample");
        front.url = Some("https://www.example.com/page-two?video=different".into());
        let observed = clock.sample(t + Duration::from_secs(1), &front);
        assert_eq!(observed, UsageSeconds { app: 1, domain: 1 });
        charge_usage(&state, &front, observed).expect("same-host debit");
        front.url = Some("https://other.test/page".into());
        let observed = clock.sample(t + Duration::from_secs(2), &front);
        assert_eq!(observed, UsageSeconds { app: 1, domain: 0 });
        charge_usage(&state, &front, observed).expect("app remains continuous");
        {
            let engine = state.engine.lock().expect("lock");
            assert_eq!(
                engine
                    .db()
                    .get_allowance_used_today(app.id)
                    .expect("app usage"),
                2
            );
            assert_eq!(
                engine
                    .db()
                    .get_allowance_used_today(first.id)
                    .expect("first site usage"),
                1
            );
            assert_eq!(
                engine
                    .db()
                    .get_allowance_used_today(second.id)
                    .expect("new site not yet debited"),
                0
            );
        }
        front.url = Some("https://other.test/another-page".into());
        charge_usage(
            &state,
            &front,
            clock.sample(t + Duration::from_secs(3), &front),
        )
        .expect("next-site debit");
        let engine = state.engine.lock().expect("lock");
        assert_eq!(
            engine
                .db()
                .get_allowance_used_today(app.id)
                .expect("app usage"),
            3
        );
        assert_eq!(
            engine
                .db()
                .get_allowance_used_today(first.id)
                .expect("old site unchanged"),
            1
        );
        assert_eq!(
            engine
                .db()
                .get_allowance_used_today(second.id)
                .expect("new site now debited"),
            1
        );
    }

    #[test]
    fn learning_video_exception_matches_exact_query_without_other_host_bypass() {
        let mut list = with_web(WebsiteMatchType::Domain("youtube.com".into()));
        list.exceptions
            .push(ExceptionRule::wildcard("*.youtube.com/watch?v=study123"));
        assert!(!check(&list, "https://www.youtube.com/watch?v=study123"));
        assert!(check(&list, "https://www.youtube.com/watch?v=fun456"));
        assert!(check(&list, "https://www.youtube.com/watch?v=study1234"));
        assert!(check(&list, "https://www.youtube.com/watch?x=study123"));
        assert!(check(&list, "https://www.youtube.com/shorts?v=study123"));
        assert!(check(
            &list,
            "https://www.youtube.com/watch?v=fun&redirect=https://www.youtube.com/watch?v=study123"
        ));
        list.websites.push(WebsiteRule::domain("other.test"));
        assert!(check(&list, "https://other.test/watch?v=study123"));
        // A user can explicitly allow additional query parameters with a star.
        list.exceptions[0] = ExceptionRule::wildcard("*.youtube.com/watch?v=study123&*");
        assert!(!check(
            &list,
            "https://www.youtube.com/watch?v=study123&t=10"
        ));
    }

    #[test]
    fn confirmed_or_rejected_action_can_recheck_but_uncertain_action_cannot_replay() {
        assert!(
            !retain_dispatch(&Ok(true)),
            "a newly reopened app is a new attempt"
        );
        assert!(
            !retain_dispatch(&Ok(false)),
            "stale target dispatched nothing"
        );
        assert!(
            !retain_dispatch(&Err(AttemptError::Rejected("permission needed".into()))),
            "fresh permission may authorize a first dispatch"
        );
        assert!(
            retain_dispatch(&Err(AttemptError::Uncertain("readback timed out".into()))),
            "never replay an uncertain dispatch"
        );
    }

    #[test]
    fn url_glob_stars_cover_nested_paths_but_literals_stay_exact() {
        assert!(url_component_glob("/*", "/one/two"));
        assert!(url_component_glob("/course/*/lesson", "/course/a/b/lesson"));
        assert!(!url_component_glob("v=abc", "v=abcd"));
        assert!(!url_component_glob("/private", "/privatex"));
    }
}
