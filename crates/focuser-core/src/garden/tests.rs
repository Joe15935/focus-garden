use super::*;
use std::sync::{Arc, Mutex};

#[derive(Clone)]
struct FakeClock(Arc<Mutex<ClockSample>>);
impl FakeClock {
    fn at(s: &str) -> Self {
        Self(Arc::new(Mutex::new(ClockSample {
            monotonic: Duration::ZERO,
            wall: DateTime::parse_from_rfc3339(s).unwrap(),
        })))
    }
    fn advance(&self, seconds: i64) {
        let mut now = self.0.lock().unwrap();
        now.monotonic += Duration::from_secs(seconds as u64);
        now.wall += chrono::Duration::seconds(seconds);
    }
    fn wall_jump(&self, seconds: i64) {
        self.0.lock().unwrap().wall += chrono::Duration::seconds(seconds);
    }
    fn advance_millis(&self, millis: u64) {
        let mut now = self.0.lock().unwrap();
        now.monotonic += Duration::from_millis(millis);
        now.wall += chrono::Duration::milliseconds(millis as i64);
    }
}
impl Clock for FakeClock {
    fn now(&self) -> ClockSample {
        self.0.lock().unwrap().clone()
    }
}
fn service() -> (GardenService, FakeClock) {
    let clock = FakeClock::at("2026-09-21T10:00:00-04:00");
    let service = GardenService::with_clock(
        Connection::open_in_memory().unwrap(),
        Box::new(clock.clone()),
    )
    .unwrap();
    (service, clock)
}
fn request(seconds: u32, strict: Strict) -> StartRequest {
    StartRequest {
        list_id: "test-list".into(),
        task: "阅读".into(),
        category: "学习".into(),
        work_secs: seconds,
        break_secs: 0,
        strict,
    }
}
fn run(service: &mut GardenService, clock: &FakeClock, seconds: u32) {
    for _ in 0..seconds {
        clock.advance(1);
        service.tick().unwrap();
    }
}

#[test]
fn exact_completion_bonus_and_duplicate_tick_are_idempotent() {
    let (mut service, clock) = service();
    service.start(request(600, Strict::Gentle)).unwrap();
    run(&mut service, &clock, 599);
    let before = service.snapshot().unwrap();
    assert_eq!(before.total_seconds, 599);
    assert_eq!(before.total_xp, 9);
    run(&mut service, &clock, 1);
    let after = service.snapshot().unwrap();
    assert_eq!(after.total_seconds, 600);
    assert_eq!(after.total_xp, 11);
    assert_eq!(after.completed_sessions, 1);
    assert!(after.active.is_none());
    run(&mut service, &clock, 10);
    assert_eq!(service.snapshot().unwrap().total_xp, 11);
    assert!(service.confirm_exit("".into(), "".into()).is_err());
    assert_eq!(service.snapshot().unwrap().total_xp, 11);
}
#[test]
fn short_sessions_have_no_xp_or_first_achievement() {
    let (mut service, clock) = service();
    service.start(request(5, Strict::Gentle)).unwrap();
    run(&mut service, &clock, 5);
    let snap = service.snapshot().unwrap();
    assert_eq!(snap.total_xp, 0);
    assert!(
        !snap
            .achievements
            .iter()
            .find(|a| a.id == "first")
            .unwrap()
            .unlocked
    );
}
#[test]
fn interruptions_keep_real_minutes_without_bonus() {
    let (mut service, clock) = service();
    service.start(request(1200, Strict::Gentle)).unwrap();
    run(&mut service, &clock, 601);
    service
        .confirm_exit("临时处理事情".into(), "".into())
        .unwrap();
    let snap = service.snapshot().unwrap();
    assert_eq!(snap.total_seconds, 601);
    assert_eq!(snap.total_xp, 10);
    assert_eq!(snap.interrupted_sessions, 1);
    assert_eq!(snap.completed_sessions, 0);
}
#[test]
fn sleep_offline_and_large_heartbeat_gaps_never_earn_credit() {
    let (mut service, clock) = service();
    service.start(request(1000, Strict::Gentle)).unwrap();
    run(&mut service, &clock, 2);
    clock.advance(100);
    service.tick().unwrap();
    assert_eq!(service.snapshot().unwrap().total_seconds, 2);
    clock.wall_jump(500);
    service.tick().unwrap();
    assert_eq!(service.snapshot().unwrap().total_seconds, 2);
    run(&mut service, &clock, 2);
    assert_eq!(service.snapshot().unwrap().total_seconds, 4);
}
#[test]
fn wall_clock_rollback_waits_until_previous_highwater() {
    let (mut service, clock) = service();
    service.start(request(1000, Strict::Gentle)).unwrap();
    run(&mut service, &clock, 10);
    clock.wall_jump(-60);
    service.tick().unwrap();
    run(&mut service, &clock, 59);
    assert_eq!(service.snapshot().unwrap().total_seconds, 10);
    run(&mut service, &clock, 2);
    assert_eq!(service.snapshot().unwrap().total_seconds, 11);
}
#[test]
fn crosses_midnight_into_two_actual_dates() {
    let clock = FakeClock::at("2026-09-21T23:59:58-04:00");
    let mut service = GardenService::with_clock(
        Connection::open_in_memory().unwrap(),
        Box::new(clock.clone()),
    )
    .unwrap();
    service.start(request(20, Strict::Gentle)).unwrap();
    clock.advance(4);
    service.tick().unwrap();
    let snap = service.snapshot().unwrap();
    assert_eq!(snap.total_seconds, 4);
    assert_eq!(snap.days.len(), 2);
    assert_eq!(
        (&*snap.days[0].date, snap.days[0].seconds),
        ("2026-09-21", 2)
    );
    assert_eq!(
        (&*snap.days[1].date, snap.days[1].seconds),
        ("2026-09-22", 2)
    );
}
#[test]
fn fractional_heartbeats_are_accumulated_but_not_rounded_up() {
    let (mut service, clock) = service();
    service.start(request(10, Strict::Gentle)).unwrap();
    for _ in 0..3 {
        clock.advance_millis(250);
        service.tick().unwrap();
    }
    assert_eq!(service.snapshot().unwrap().total_seconds, 0);
    clock.advance_millis(250);
    service.tick().unwrap();
    assert_eq!(service.snapshot().unwrap().total_seconds, 1);
}
#[test]
fn focus_cooldown_is_backend_enforced_and_request_is_idempotent() {
    let (mut service, clock) = service();
    service.start(request(1000, Strict::Focus)).unwrap();
    assert!(service.confirm_exit("需要休息".into(), "".into()).is_err());
    let requested = service
        .request_exit()
        .unwrap()
        .active
        .unwrap()
        .exit_requested_at;
    run(&mut service, &clock, 20);
    let snap = service.request_exit().unwrap();
    assert_eq!(snap.active.as_ref().unwrap().exit_remaining_secs, 10);
    assert_eq!(snap.active.unwrap().exit_requested_at, requested);
    assert!(service.confirm_exit("需要休息".into(), "".into()).is_err());
    run(&mut service, &clock, 10);
    assert!(service.confirm_exit(" ".into(), "".into()).is_err());
    service.confirm_exit("需要休息".into(), "".into()).unwrap();
    assert!(service.snapshot().unwrap().active.is_none());
}
#[test]
fn deep_cooldown_ignores_wall_jump_and_requires_exact_phrase() {
    let (mut service, clock) = service();
    service.start(request(1000, Strict::Deep)).unwrap();
    service.request_exit().unwrap();
    clock.wall_jump(5000);
    service.tick().unwrap();
    assert_eq!(
        service
            .snapshot()
            .unwrap()
            .active
            .unwrap()
            .exit_remaining_secs,
        300
    );
    assert!(
        service
            .confirm_exit("有急事".into(), DEEP_EXIT_CONFIRMATION.into())
            .is_err()
    );
    run(&mut service, &clock, 299);
    assert!(
        service
            .confirm_exit("有急事".into(), DEEP_EXIT_CONFIRMATION.into())
            .is_err()
    );
    run(&mut service, &clock, 1);
    assert!(
        service
            .confirm_exit("有急事".into(), "随便结束".into())
            .is_err()
    );
    service
        .confirm_exit("有急事".into(), DEEP_EXIT_CONFIRMATION.into())
        .unwrap();
    assert_eq!(service.snapshot().unwrap().interrupted_sessions, 1);
}
#[test]
fn break_does_not_earn_focus_and_can_end_immediately() {
    let (mut service, clock) = service();
    let mut req = request(60, Strict::Deep);
    req.break_secs = 30;
    service.start(req).unwrap();
    run(&mut service, &clock, 60);
    let snap = service.snapshot().unwrap();
    assert_eq!(snap.active.unwrap().status, Status::Break);
    assert_eq!(snap.total_xp, 1);
    run(&mut service, &clock, 10);
    let snap = service.snapshot().unwrap();
    assert_eq!(snap.total_seconds, 60);
    assert_eq!(snap.active.unwrap().break_remaining_secs, 20);
    service.confirm_exit("".into(), "".into()).unwrap();
    let snap = service.snapshot().unwrap();
    assert_eq!(snap.completed_sessions, 1);
    assert_eq!(snap.interrupted_sessions, 0);
    assert!(snap.active.is_none());
}
#[test]
fn natural_break_end_releases_active_without_duplicate_rewards() {
    let (mut service, clock) = service();
    let mut req = request(60, Strict::Gentle);
    req.break_secs = 2;
    service.start(req).unwrap();
    run(&mut service, &clock, 62);
    let snap = service.snapshot().unwrap();
    assert!(snap.active.is_none());
    assert_eq!(snap.total_seconds, 60);
    assert_eq!(snap.total_xp, 1);
}
#[test]
fn restart_preserves_progress_config_and_safely_interrupts() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("garden.sqlite");
    let clock = FakeClock::at("2026-09-21T10:00:00-04:00");
    {
        let mut service =
            GardenService::with_clock(Connection::open(&path).unwrap(), Box::new(clock.clone()))
                .unwrap();
        let config = Config {
            theme: "dark".into(),
            ..Config::default()
        };
        service.update_config(config).unwrap();
        service.start(request(600, Strict::Deep)).unwrap();
        run(&mut service, &clock, 65);
        service.request_exit().unwrap();
    }
    clock.advance(10000);
    let mut restored =
        GardenService::with_clock(Connection::open(&path).unwrap(), Box::new(clock.clone()))
            .unwrap();
    let snap = restored.snapshot().unwrap();
    assert!(snap.active.is_none());
    assert_eq!(snap.total_seconds, 65);
    assert_eq!(snap.total_xp, 1);
    assert_eq!(snap.config.theme, "dark");
    assert_eq!(snap.interrupted_sessions, 1);
    restored.recover_on_launch().unwrap();
    assert_eq!(restored.snapshot().unwrap().total_seconds, 65);
}
#[test]
fn restart_during_break_keeps_completion() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("garden.sqlite");
    let clock = FakeClock::at("2026-09-21T10:00:00-04:00");
    {
        let mut service =
            GardenService::with_clock(Connection::open(&path).unwrap(), Box::new(clock.clone()))
                .unwrap();
        let mut req = request(60, Strict::Gentle);
        req.break_secs = 300;
        service.start(req).unwrap();
        run(&mut service, &clock, 60);
    }
    let restored =
        GardenService::with_clock(Connection::open(&path).unwrap(), Box::new(clock.clone()))
            .unwrap();
    let snap = restored.snapshot().unwrap();
    assert_eq!(snap.completed_sessions, 1);
    assert_eq!(snap.interrupted_sessions, 0);
    assert_eq!(snap.total_xp, 1);
}
#[test]
fn configurable_streak_and_gap_are_calendar_based() {
    let (mut service, clock) = service();
    let config = Config {
        streak_minutes: 1,
        ..Config::default()
    };
    service.update_config(config).unwrap();
    for day in 0..3 {
        if day > 0 {
            clock.advance(86400 - 60);
            service.tick().unwrap();
        }
        service.start(request(60, Strict::Gentle)).unwrap();
        run(&mut service, &clock, 60);
    }
    let snap = service.snapshot().unwrap();
    assert_eq!(snap.current_streak, 3);
    assert_eq!(snap.longest_streak, 3);
    clock.advance(86400);
    service.tick().unwrap();
    assert_eq!(service.snapshot().unwrap().current_streak, 3);
    clock.advance(86400);
    service.tick().unwrap();
    let snap = service.snapshot().unwrap();
    assert_eq!(snap.current_streak, 0);
    assert_eq!(snap.longest_streak, 3);
}
#[test]
fn block_counters_require_work_and_make_real_achievements() {
    let (mut service, clock) = service();
    service.record_block("app").unwrap();
    service.start(request(60, Strict::Gentle)).unwrap();
    for _ in 0..10 {
        service.record_block("app").unwrap();
    }
    service.record_block("website").unwrap();
    assert!(service.record_block("fake").is_err());
    run(&mut service, &clock, 60);
    service.record_block("website").unwrap();
    let snap = service.snapshot().unwrap();
    assert_eq!(snap.app_blocks, 10);
    assert_eq!(snap.website_blocks, 1);
    assert!(
        snap.achievements
            .iter()
            .find(|a| a.id == "app_guard")
            .unwrap()
            .unlocked
    );
    assert!(snap.achievements.len() >= 20);
}
#[test]
fn outcome_exports_are_local_escaped_and_cannot_rewrite_rewards() {
    let (mut service, clock) = service();
    let mut req = request(60, Strict::Gentle);
    req.task = "=HYPERLINK(\"unsafe\")\n第二行".into();
    let id = service.start(req).unwrap().active.unwrap().id;
    assert!(service.set_outcome(id.clone(), Outcome::Completed).is_err());
    run(&mut service, &clock, 60);
    service.set_outcome(id, Outcome::Completed).unwrap();
    let snap = service.snapshot().unwrap();
    assert_eq!(snap.total_xp, 1);
    assert_eq!(snap.days[0].tasks.len(), 1);
    let json = service.export_json().unwrap();
    assert!(serde_json::from_str::<Snapshot>(&json).is_ok());
    let csv = service.export_csv().unwrap();
    assert!(csv.contains("\"'=HYPERLINK(\"\"unsafe\"\")\n第二行\""));
    assert!(csv.contains("focus_seconds"));
}
#[test]
fn settings_reject_invalid_enums_goals_and_unearned_decorations() {
    let (mut service, _) = service();
    let config = Config {
        plant: "tree".into(),
        ..Config::default()
    };
    assert!(service.update_config(config).is_err());
    let config = Config {
        plant: "imaginary".into(),
        ..Config::default()
    };
    assert!(service.update_config(config).is_err());
    let config = Config {
        streak_minutes: 0,
        ..Config::default()
    };
    assert!(service.update_config(config).is_err());
    let config = Config {
        theme: "bright".into(),
        ..Config::default()
    };
    assert!(service.update_config(config).is_err());
}
#[test]
fn invalid_and_concurrent_starts_are_rejected() {
    let (mut service, _) = service();
    assert!(service.start(request(0, Strict::Gentle)).is_err());
    service.start(request(60, Strict::Gentle)).unwrap();
    assert!(service.start(request(60, Strict::Gentle)).is_err());
    assert_eq!(service.snapshot().unwrap().sessions.len(), 1);
}
