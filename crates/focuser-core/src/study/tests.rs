use super::*;
use serde_json::json;

fn store() -> (tempfile::TempDir, StudyStore) {
    let dir = tempfile::tempdir().unwrap();
    let store =
        StudyStore::open(dir.path().join("study.sqlite3"), dir.path().join("backups")).unwrap();
    (dir, store)
}

fn doc(name: &str) -> Value {
    json!({
        "policy": {"wake": "07:00", "sleep": "23:00"},
        "semesters": [{"id": "term-a", "name": name}],
        "goal": null
    })
}

fn event(id: &str, minutes: u32) -> StudyEvent {
    StudyEvent {
        id: id.into(),
        date: "2026-09-28".into(),
        task_key: "lecture:civil-1".into(),
        kind: "watched".into(),
        minutes,
        source: "自报".into(),
        self_reported: true,
        session_id: None,
        corrects: None,
        recorded_at: None,
    }
}

fn card(id: &str) -> Value {
    json!({"id": id, "prompt": "成立条件？", "source": "民法主书第10页", "stage": 0, "dueDate": "2026-09-29", "history": []})
}

fn link(session: &str, occurrence: &str) -> SessionLink {
    SessionLink {
        session_id: session.into(),
        occurrence_id: occurrence.into(),
        date: "2026-09-28".into(),
        task_key: "law-1".into(),
        title: "法硕第1节".into(),
        minutes: 55,
        created_at: "2026-09-28T08:20:00+08:00".into(),
    }
}

#[test]
fn empty_store_has_revision_zero() {
    let (_d, s) = store();
    let snap = s.snapshot().unwrap();
    assert_eq!(snap.revision, 0);
    assert!(snap.doc.is_none());
    assert_eq!(snap.schema_version, SCHEMA_VERSION);
}

#[test]
fn doc_save_is_compare_and_swap() {
    let (_d, mut s) = store();
    assert_eq!(s.save_doc(0, &doc("A")).unwrap(), 1);
    // A stale writer that still believes revision 0 must not overwrite.
    let err = s.save_doc(0, &doc("stale")).unwrap_err();
    assert!(matches!(err, StudyError::Conflict { current: 1 }));
    assert_eq!(
        s.snapshot().unwrap().doc.unwrap()["semesters"][0]["name"],
        "A"
    );
    assert_eq!(s.save_doc(1, &doc("B")).unwrap(), 2);
}

#[test]
fn doc_shape_is_checked() {
    let (_d, mut s) = store();
    assert!(s.save_doc(0, &json!([])).is_err());
    assert!(s.save_doc(0, &json!({"semesters": []})).is_err());
    assert!(
        s.save_doc(
            0,
            &json!({"policy": {}, "semesters": [{"id": "x"}, {"id": "x"}]})
        )
        .is_err()
    );
    assert_eq!(s.revision().unwrap(), 0);
}

#[test]
fn events_are_idempotent_and_never_overwritten() {
    let (_d, mut s) = store();
    assert!(s.append_event(&event("e1", 50)).unwrap());
    assert!(!s.append_event(&event("e1", 50)).unwrap());
    assert!(s.append_event(&event("e1", 20)).is_err());
    let events = s.snapshot().unwrap().events;
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].minutes, 50);
}

#[test]
fn corrections_append_rather_than_edit() {
    let (_d, mut s) = store();
    s.append_event(&event("e1", 50)).unwrap();
    let mut fix = event("e2", 35);
    fix.kind = "partial".into();
    fix.corrects = Some("e1".into());
    s.append_event(&fix).unwrap();
    let events = s.snapshot().unwrap().events;
    assert_eq!(events.len(), 2);
    assert_eq!(events[0].minutes, 50);
    assert_eq!(events[1].corrects.as_deref(), Some("e1"));
}

#[test]
fn invalid_events_rejected() {
    let (_d, mut s) = store();
    let mut bad = event("x", 10);
    bad.date = "2026-02-30".into();
    assert!(s.append_event(&bad).is_err());
    let mut bad = event("x", 601);
    bad.minutes = 601;
    assert!(s.append_event(&bad).is_err());
    let mut bad = event("x", 10);
    bad.kind = "mastered".into();
    assert!(s.append_event(&bad).is_err());
    assert!(s.snapshot().unwrap().events.is_empty());
}

#[test]
fn a_session_links_to_one_task_only() {
    let (_d, mut s) = store();
    s.link_session(&link("s1", "2026-09-28:law-1")).unwrap();
    assert!(s.link_session(&link("s1", "2026-09-28:law-2")).is_err());
    // A later session may continue the same occurrence (resumed partial work).
    s.link_session(&link("s2", "2026-09-28:law-1")).unwrap();
    assert_eq!(s.snapshot().unwrap().links.len(), 2);
}

#[test]
fn reviews_upsert_by_id() {
    let (_d, mut s) = store();
    s.upsert_review(&card("c1")).unwrap();
    let mut updated = card("c1");
    updated["stage"] = json!(1);
    s.upsert_review(&updated).unwrap();
    let reviews = s.snapshot().unwrap().reviews;
    assert_eq!(reviews.len(), 1);
    assert_eq!(reviews[0]["stage"], 1);
    assert!(s.upsert_review(&json!({"id": "c2", "prompt": "", "source": "x", "dueDate": "2026-09-29", "history": []})).is_err());
}

#[test]
fn export_import_round_trip() {
    let (_d, mut a) = store();
    a.save_doc(0, &doc("A")).unwrap();
    a.append_event(&event("e1", 50)).unwrap();
    a.upsert_review(&card("c1")).unwrap();
    a.link_session(&link("s1", "o1")).unwrap();
    a.record_plan(&PlanRevision {
        id: 0,
        date: "2026-09-28".into(),
        input_revision: 1,
        status: "FEASIBLE".into(),
        reason: "起晚30分钟后重排".into(),
        data: json!({"blocks": []}),
        created_at: String::new(),
    })
    .unwrap();
    let backup = a.export().unwrap();
    let text = serde_json::to_string(&backup).unwrap();

    let (_d2, mut b) = store();
    let parsed: StudyBackup = serde_json::from_str(&text).unwrap();
    b.import(&parsed, 0).unwrap();
    let sa = a.snapshot().unwrap();
    let sb = b.snapshot().unwrap();
    assert_eq!(sa.doc, sb.doc);
    assert_eq!(sa.events.len(), sb.events.len());
    assert_eq!(sa.events[0].id, sb.events[0].id);
    assert_eq!(sa.reviews, sb.reviews);
    assert_eq!(sa.links, sb.links);
    assert_eq!(sb.plans.len(), 1);
}

#[test]
fn bad_import_leaves_old_data() {
    let (_d, mut s) = store();
    s.save_doc(0, &doc("keep")).unwrap();
    s.append_event(&event("e1", 50)).unwrap();
    let mut backup = s.export().unwrap();
    backup.events.push(event("e1", 50)); // duplicate id
    assert!(s.import(&backup, 1).is_err());
    let mut wrong = s.export().unwrap();
    wrong.version = 999;
    assert!(s.import(&wrong, 1).is_err());
    let mut foreign = s.export().unwrap();
    foreign.format = "focus-garden-backup".into();
    assert!(s.import(&foreign, 1).is_err());
    let snap = s.snapshot().unwrap();
    assert_eq!(snap.doc.unwrap()["semesters"][0]["name"], "keep");
    assert_eq!(snap.events.len(), 1);
    assert_eq!(snap.revision, 1);
}

#[test]
fn stale_import_refused() {
    let (_d, mut s) = store();
    s.save_doc(0, &doc("A")).unwrap();
    let backup = s.export().unwrap();
    assert!(matches!(
        s.import(&backup, 0),
        Err(StudyError::Conflict { current: 1 })
    ));
}

#[test]
fn backup_and_restore_drill_on_disk() {
    let (dir, mut s) = store();
    s.save_doc(0, &doc("before")).unwrap();
    s.append_event(&event("e1", 50)).unwrap();
    s.upsert_review(&card("c1")).unwrap();
    let name = s.backup_now("manual").unwrap();
    assert!(dir.path().join("backups").join(&name).is_file());

    // Change live data after the backup.
    s.save_doc(1, &doc("after")).unwrap();
    s.append_event(&event("e2", 30)).unwrap();

    // Drill: restore into an isolated second store first and compare.
    let isolated = tempfile::tempdir().unwrap();
    let mut probe = StudyStore::open(
        isolated.path().join("study.sqlite3"),
        isolated.path().join("backups"),
    )
    .unwrap();
    let content = s.read_backup(&name).unwrap();
    probe.import(&content, 0).unwrap();
    let p = probe.snapshot().unwrap();
    assert_eq!(p.doc.unwrap()["semesters"][0]["name"], "before");
    assert_eq!(p.events.len(), 1);
    assert_eq!(p.reviews.len(), 1);

    // Real restore on the live store.
    let revision = s.revision().unwrap();
    s.restore(&name, revision).unwrap();
    let snap = s.snapshot().unwrap();
    assert_eq!(snap.doc.unwrap()["semesters"][0]["name"], "before");
    assert_eq!(snap.events.len(), 1);
    // A safety copy of the pre-restore state exists.
    assert!(
        s.list_backups()
            .unwrap()
            .iter()
            .any(|b| b.kind == "pre-restore")
    );
}

#[test]
fn restored_data_survives_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("study.sqlite3");
    {
        let mut s = StudyStore::open(&path, dir.path().join("b")).unwrap();
        s.save_doc(0, &doc("durable")).unwrap();
        s.append_event(&event("e1", 50)).unwrap();
    }
    let s = StudyStore::open(&path, dir.path().join("b")).unwrap();
    let snap = s.snapshot().unwrap();
    assert_eq!(snap.revision, 1);
    assert_eq!(snap.events.len(), 1);
}

#[test]
fn restore_refuses_paths_outside_backup_folder() {
    let (_d, mut s) = store();
    assert!(s.restore("../study.sqlite3", 0).is_err());
    assert!(s.restore("/etc/passwd", 0).is_err());
    assert!(s.restore("garden.sqlite3", 0).is_err());
}

#[test]
fn corrupt_backup_refused() {
    let (dir, mut s) = store();
    s.save_doc(0, &doc("keep")).unwrap();
    std::fs::create_dir_all(dir.path().join("backups")).unwrap();
    let name = "study-manual-20260101-000000.000.sqlite3";
    std::fs::write(dir.path().join("backups").join(name), b"not a database").unwrap();
    assert!(s.restore(name, 1).is_err());
    assert_eq!(
        s.snapshot().unwrap().doc.unwrap()["semesters"][0]["name"],
        "keep"
    );
}

#[test]
fn newer_schema_is_refused_untouched() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("study.sqlite3");
    {
        let db = Connection::open(&path).unwrap();
        db.execute_batch(
            "CREATE TABLE study_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             INSERT INTO study_meta VALUES('schema_version','99');",
        )
        .unwrap();
    }
    assert!(StudyStore::open(&path, dir.path().join("b")).is_err());
    let db = Connection::open(&path).unwrap();
    let v: String = db
        .query_row("SELECT value FROM study_meta", [], |r| r.get(0))
        .unwrap();
    assert_eq!(v, "99");
}

#[test]
fn auto_backup_once_per_day_and_rotates() {
    let (_d, mut s) = store();
    assert!(
        s.auto_backup().unwrap().is_empty(),
        "empty store needs no backup"
    );
    s.save_doc(0, &doc("A")).unwrap();
    let first = s.auto_backup().unwrap();
    assert_eq!(first.len(), 2); // daily + weekly
    assert!(s.auto_backup().unwrap().is_empty());
    for _ in 0..(MANUAL_KEEP + 3) {
        s.backup_now("manual").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2));
    }
    let manual = s
        .list_backups()
        .unwrap()
        .into_iter()
        .filter(|b| b.kind == "manual")
        .count();
    assert_eq!(manual, MANUAL_KEEP);
}

#[test]
fn backup_kinds_parse() {
    assert_eq!(
        backup_kind("study-daily-20260926-101010.123.sqlite3"),
        Some("daily")
    );
    assert_eq!(
        backup_kind("study-pre-import-20260926-101010.123.sqlite3"),
        Some("pre-import")
    );
    assert_eq!(backup_kind("garden.sqlite3"), None);
    assert_eq!(backup_kind("study-evil-1.sqlite3"), None);
}

#[test]
fn device_settings_are_separate_from_study_data() {
    let (_d, mut s) = store();
    s.save_doc(0, &doc("A")).unwrap();
    s.set_setting("mirror_dir", Some("/tmp/x")).unwrap();
    assert_eq!(
        s.get_setting("mirror_dir").unwrap().as_deref(),
        Some("/tmp/x")
    );
    // Settings never travel inside a backup, and do not bump the data revision.
    assert_eq!(s.revision().unwrap(), 1);
    let backup = s.export().unwrap();
    assert!(!serde_json::to_string(&backup).unwrap().contains("/tmp/x"));
    s.set_setting("mirror_dir", None).unwrap();
    assert!(s.get_setting("mirror_dir").unwrap().is_none());
}
