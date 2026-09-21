# Four-candidate source audit (2026-09-21)

Scope: GitHub API metadata, releases, issues, LICENSE, targeted source inspection. No installs, builds, live feature verification, system permission or existing project changes. All runtime compatibility/resource consumption assertions remain UNKNOWN. Source feature presence is not a runtime PASS.

| Project | License | All-free | Mac / Apple Silicon evidence | Chinese | App block | Web block | Weekly | Pomodoro | Daily allowance | Strict | Streak | Achievements | Fun | Last push |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| imanabdulm/Orilo-App | MIT | No gate found; donation only in code inspected | Native SwiftUI macOS 14+; SPM source; release architecture UNKNOWN | NO, hardcoded English, no catalog found | Gentle overlay / hide only | NO implementation found | NO implementation found | YES source | NO | FAIL: direct End and pause | YES current/best | Limited milestone messages | Focus Proof / milestones | 2026-07-19 |
| builder-group/abstand | AGPL-3.0-only | Current gate not found; explicit future paid builds/update direction | Tauri/Rust/Swift; aarch64+x64 release | NO resources found | YES overlay | YES browser overlays | YES | NO, Break future | NO | YES source, casual/balanced/strict | NO | NO, future artifact concept | Future concepts only | 2026-09-12 |
| VishalJ99/fence | GPL-3.0 | NO: trial/licensing/server/purchase | Objective-C native; arm64 documented, runtime UNKNOWN | PARTIAL legacy zh-Hans; new schedule/license UI hardcoded English | YES source | YES hosts/PF source | YES | NO found | Break skip credits only, not per-app/web time quota | YES source, emergency exit present | NO | NO | NO | 2026-09-08 |
| yagizdo/standlock | MIT | No gate found; donation only | Swift macOS 13+, release; runtime UNKNOWN | NO, en+tr only | NO selective app blocking | NO | YES break schedules | YES break cycles | Skip limit only | YES input-lock + key emergency | YES break streak | NO | Escape mini-games, not focus rewards | 2026-09-19 |

Decision: NONE satisfies all hard requirements. Do not install these as a completed solution. Orilo provides reasonable local streak/milestone UX reference. StandLock's statistics/heatmap can be studied, but crate/slot/roast designs conflict with the requested gentle, nongambling positive feedback.

## Exact inspected revisions

- Orilo-App `4249eceb383dc2b149f9eee54349e69799fbc930`
- abstand `a56fabd30593f338e034f9d4497fd0a3e359987e` (develop)
- fence `14f28f31080658ccec208f30a43b4e4fdf428a9f` (master)
- standlock `91b9706cf36d69b53a89e9a35b457b7c8e55ca44`

## Orilo source evidence

- [LICENSE](https://github.com/imanabdulm/Orilo-App/blob/4249eceb383dc2b149f9eee54349e69799fbc930/LICENSE): MIT.
- [Package.swift](https://github.com/imanabdulm/Orilo-App/blob/4249eceb383dc2b149f9eee54349e69799fbc930/Package.swift): Swift 5.9; macOS 14; no external package dependency.
- `Sources/Orilo/Services/DistractionOverlayController.swift`: overlay allows Keep going after 4 seconds, optional hide, not hard enforcement.
- `Sources/Orilo/Views/MenuBar/ActiveSessionView.swift`: End directly calls `endSession()`, Pause direct; fails meaningful strict requirement.
- `Sources/Orilo/ViewModels/FocusViewModel.swift`: current/longest streak (283+), milestone messages for counts 1/5/10/25/50/100; clean sessions 5/10/25; streak 3/7/14/30 (337+).
- `Sources/Orilo/Stores/LocalPersistenceStore.swift` / `Services/DataExportService.swift`: local data and export.
- `SECURITY.md` declares local `~/Library/Application Support/Orilo/`, no remote telemetry. Targeted Swift scan found only Ko-fi external URL, no StoreKit imports/calls; entitlement comment mentions StoreKit but no active purchase implementation found.
- UI strings hardcoded in Swift; no .xcstrings/.lproj source resource found; no website blocker or weekly schedule model found.
- [Release](https://github.com/imanabdulm/Orilo-App/releases/tag/v1.0.0): 2026-07-19, DMG filename Orilo-0.1.0 despite tag v1.0.0. Issues API returned [] at inspection.

## Abstand source evidence

- [LICENSE](https://github.com/builder-group/abstand/blob/a56fabd30593f338e034f9d4497fd0a3e359987e/LICENSE) explicitly AGPL v3; `apps/desktop/package.json` specifies AGPL-3.0-only. GitHub API NOASSERTION is parser failure, not missing license.
- [Project spec](https://github.com/builder-group/abstand/blob/a56fabd30593f338e034f9d4497fd0a3e359987e/docs/project-spec.md) says current scope Block + menu bar; Break/Flow/session rewards are later; pricing direction one-time purchase and one year updates. No paywall found in targeted current desktop source/dependency scan; future paid direction must not be represented as current implemented paywall.
- `apps/desktop/src-tauri/src/modules/blocking/README.md`: app/website window overlays, mado Accessibility observations; 200ms reconciliation timer while overlays exist; 2-second metadata reconciliation; no CPU measurement.
- `apps/desktop/src-tauri/src/modules/quit_policy/README.md`: Balanced frontend delay, Strict backend quit prevention; out-of-process recovery agent. Strict Emergency recovery runtime not tested.
- `apps/desktop/src/modules/intentions/block/components/WhenSection/RepeatsRows.tsx`: weekday scheduling implemented.
- `apps/desktop/src-tauri/src/modules/recovery_agent/user_launch_agent.rs`: user launch-agent recovery exists; increases install/rollback scope.
- Source uses local SQLite/JSON; scanned dependencies no tracking SDK. Updater network exists; no mandatory account found.
- [Release v0.1.31](https://github.com/builder-group/abstand/releases/tag/v0.1.31) 2026-09-12: official aarch64/x64 DMG.
- Open issues: [#23 Accessibility revoked disables blocking](https://github.com/builder-group/abstand/issues/23), [#24 changing clock ends intention](https://github.com/builder-group/abstand/issues/24), [#33 password to end intention](https://github.com/builder-group/abstand/issues/33). Browser compatibility fixes exist in closed #25/#31; does not prove actual installed browsers pass.

## Fence source evidence

- [COPYING](https://github.com/VishalJ99/fence/blob/14f28f31080658ccec208f30a43b4e4fdf428a9f/COPYING): GPL-3.0.
- [SETUP.md](https://github.com/VishalJ99/fence/blob/14f28f31080658ccec208f30a43b4e4fdf428a9f/SETUP.md) has Removing Licensing Logic for Forks section; proves official implementation carries licensing.
- `Common/SCLicenseManager.m`: trial expiry checks and `/api/activate`, `/api/trial/check`; `server/index.js` implements license activation/trial tracking and Stripe webhook integration.
- `SCLicenseWindowController.m` and `SCMenuBarController.m` link official pricing. Not donation-only.
- `Podfile` contains Sentry 9.14.0; `Common/SCSentry.*`, error reporting menu toggle; telemetry call for emergency unlock. Do not say always-on telemetry; code has opt-in controls, but SDK is present and forbidden by user's requirement.
- `zh-Hans.lproj` inherited translations exist. New `SCWeekScheduleWindowController.m` Emergency Unlock/other schedule labels and license UI hardcoded English, so complete Chinese fails.
- `SCWeekScheduleWindowController.m` has Emergency Exit flow (1354+); README's no-escape phrasing is outdated. Do not claim no safety exit from README alone.
- `PreferencesProtectionViewController.m` has daily break credits; these are not per-app/domain daily time allowance.
- Runtime depends on privileged daemon/helper and host/PF blocking; CocoaPods + signing setup required.
- [Release v3.4.14](https://github.com/VishalJ99/fence/releases/tag/v3.4.14), 2026-09-08. Open #11 purchase dialog duplicate; #17 blocklist UI differs daemon; #18 drag/resize hangs. Reject by fee/account/telemetry/Chinese/positive-feedback requirements without installing.

## StandLock source evidence

- [LICENSE](https://github.com/yagizdo/standlock/blob/91b9706cf36d69b53a89e9a35b457b7c8e55ca44/LICENSE): MIT.
- `StandLock/Localizable.xcstrings`: JSON `sourceLanguage=en`, only localization key `tr`; [#47 Simplified Chinese request](https://github.com/yagizdo/standlock/issues/47) OPEN.
- `StandLockKit/Sources/StandLockCore/Models/DisciplineLevel.swift`: Gentle/Firm/Strict escape policies; Strict key-hold exit, progressive skip delays.
- `StandLockKit/Sources/Locking/EventTapController.swift` / `EscapeDetector.swift`: actual keyboard/mouse block and emergency combo code, untested here.
- `StandLockKit/Sources/StandLockCore/Models/BreakStatistics.swift`, `BreakHistory.swift`, `StandLock/Views/Settings/StatisticsView.swift`: break completion/skip/current/best streak + annual heatmap.
- `Models/EnforcementPolicy.swift`, `Models/DisciplineLevel.swift` contain `crateOpening`, `slotMachine`, `roastChallenge` escape challenges. They are not paid gambling but unsuitable to copy for this task's UX.
- `project.yml`: macOS 13. `StandLock/Info.plist`: Sparkle GitHub appcast network, update checking off by default per README; no account/tracking SDK found in targeted source scan.
- [Release v0.7.0](https://github.com/yagizdo/standlock/releases/tag/v0.7.0), 2026-09-19. [#39 fullscreen Spaces overlay gap](https://github.com/yagizdo/standlock/issues/39) OPEN.

## Verification commands executed

- `gh api repos/{owner}/{repo}` with compact metadata filters.
- `gh api repos/{owner}/{repo}/releases` and `gh issue list --state all --limit 10`.
- `gh repo clone ... -- --depth=1` initially failed on Xcode license. Retried successfully with process-only `DEVELOPER_DIR=/Library/Developer/CommandLineTools`.
- Targeted `rg`, `sed`, and JSON language catalog inspection.
- No build/tests/app launches performed; no runtime PASS asserted.
