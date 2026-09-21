# Focus Garden integration contract

Base: Focuser c49a980f4b2b9c09c4520001a0cdc4f11466feff (MIT). Independent fork; upstream remote retained. User explicitly authorized automatic extension if no existing candidate qualifies. No edits outside this new project except final user-local .app and app-owned data.

Architecture: reuse Focuser Rust rule engine, schedules, allowance tracker, SQLite and translated rule editors. Replace desktop Mac runtime, never start upstream hosts writer, process killer or unauthenticated HTTP API. No paid API, account, telemetry, network service, auto-updater, or persistent root service.

## Garden core contract (focuser-core/src/garden.rs)
Expose serializable types and `GardenService` with an independent app-owned SQLite connection (reuse rusqlite already in workspace). Root wraps in Mutex in Tauri; functions execute under it. Core accepts elapsed monotonic ticks, not frontend-supplied earned minutes. Prefer methods: open(path), snapshot(), start(StartRequest), tick(), request_exit(), confirm_exit(reason,confirmation), set_outcome(id,outcome), update_config(config), export_json(), export_csv(), recover_on_launch(). Methods may vary but document final signature early.

StartRequest: {list_id:string,task:string,category:string,work_secs:u32,break_secs:u32,strict:'gentle'|'focus'|'deep'}.
Snapshot: {config,active:Session|null,sessions:Session[],total_seconds,total_xp,level,level_xp,level_next_xp,current_streak,longest_streak,achievements:Achievement[],days:Day[]}.
Config: {daily_goal_minutes,weekly_goal_minutes,streak_minutes,theme:'system'|'light'|'dark',plant,pot,background}.
Session: {id,list_id,task,category,started_at,ended_at?,local_date,planned_secs,elapsed_secs,break_secs,strict,status:'work'|'break'|'completed'|'interrupted',reason?,outcome:'pending'|'completed'|'partial'|'unfinished',exit_requested_at?,exit_remaining_secs,xp}.
Day: {date,seconds,sessions,tasks:string[]}.
Achievement: {id,title,description,unlocked:bool} (>=20 real criteria).
Reward: completed real minute =1 XP, finished session +floor(minutes/10); short test below 1m no XP/plant. No skip path credits full duration. Breaks no XP. Pauses/sleep/offline no credit. Restart preserves progress, marks interrupted without completion bonus. Duplicate finish idempotent. Streak local calendar; gate configurable. Non-gentle exit cooldown enforced by backend (30s/300s), deep confirmation exact Chinese phrase; request_exit idempotent.

## Tauri bridge owned by root
`garden_command({command:{cmd,args?}})` returns plain JSON. Commands: snapshot, start, request_exit, confirm_exit, set_outcome, update_config, export_json, export_csv. args fields per core. Installed apps via `installed_apps`; native health via `mac_health`; browser permission request via `request_browser_permission({browser})`; app whitelist configuration via core settings `garden_app_mode:<listID>` (`blacklist` default / `whitelist`). Root guards legacy mutation APIs during work and disables old Pomodoro UI/commands for this app.

Mac runtime receives shared upstream AppContext and separate garden service; every tick query active list from service then evaluate a cloned list with enabled=true and schedule=None, independently of base list flags. Under work, other lists and schedules still apply. Only work phase force-applies session list. On break/completed/interrupted no overlay. Do not mutate user's saved list states. Website matcher must respect per-list exceptions and URL boundaries; app identity via bundle ID/executable/path; whitelist only ordinary user-facing apps and never Finder/System Settings/Terminal/Codex/Focus Garden etc. Use reversible hide/shield rather than SIGKILL. Count actual confirmed blocking events. Mac permission status explicit, no permission bypass. Only process/URL data needed for blocking, no full browser history.

## Ownership
Root: Tauri main/bridge, packaging/config, docs/integration/testing.
Garden agent: core garden.rs + tests and registration/Cargo deps only if needed.
Mac agent: separate src/mac_guard.rs and any helper file it uniquely owns, no main/config changes.
UI agent: frontend files; preserve upstream rule editors, new warm Chinese garden home and stats/achievements/heatmap; installed apps picker; safe settings; no external new dependencies.

Acceptance: core regression + meaningful safety tests; build actual arm64 .app; GUI screenshot and interaction; real harmless app and example.com test; exit+relaunch persistence. OS reboot cannot be called PASS without actual reboot. No user browser termination, no hosts/proxy edits. Full fmt/clippy/workspace tests before checkpoint commits; frontend typecheck/tests/build.
