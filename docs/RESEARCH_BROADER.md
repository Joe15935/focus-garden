# Additional open-source candidate audit

Verified 2026-09-21 with Agent Reach's Exa search and GitHub CLI. Source-only audit, not an installed-app PASS. Independent shallow checkouts are in `/tmp/focus-garden-broader-audit`. No audited app was installed. All decisions preserve UNKNOWN where runtime compatibility was not exercised.

Searches covered: open source productivity gamification; gamified focus app open source; Pomodoro streak achievements open source; digital wellbeing open source macOS; Chinese macOS focus blocker; GitHub self control macOS; open source Cold Turkey alternative. Exa returned the named candidates plus StreaX, focus-pulse, KeepaCountable, tomato-pomodoring, AppJail and other narrow timer/blocker tools. Three promising newer candidates received LICENSE, releases, issues and source checks below.

| Project | License | All core free | Mac | Chinese | App block | Website block | Weekly schedule | Pomodoro | Daily allowance | Safe strict | Streak | Achievements | Fun | Last push |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| aowshad/Focus | MIT | No payment/online dependency found in inspected runtime | Tauri, arm64 release; not run | No, English literals | No | No | No | Yes | No | No | Yes | Not found | Heatmap | 2026-07-08 |
| builder-group/focuscat | AGPL-3.0-or-later per Cargo; root AGPLv3 | No paywall/account/telemetry found in inspected runtime | Tauri+Swift, arm64/x64 releases; not run | No, English literals | Foreground overlay | Foreground URL overlay | Yes | Yes | Not found | No cancellation friction in timer reset | Not found | Not found | Cat customization | 2026-08-12 |
| ashdeck/ashdeck | AGPL-3.0 | NO: explicit Premium annual/lifetime and backend | Browser extension, no native app | Not found | No | Chrome DNR code | Partial/source | Yes | Not verified | Not verified | Not verified | Not verified | Sounds/wallpapers | 2026-06-24 |
| SelfControlApp/selfcontrol | GPL-3.0 | Yes | Native, current machine not run | Incomplete evidence: loose Chinese strings, no Chinese lproj | No | PF+hosts | No core weekly UI found | Countdown only | No | No routine emergency exit | No | No | No | 2026-06-26 |
| thesrivamshi/HanuFocus | MIT | No paid requirement in inspected code | SwiftUI arm64 macOS14+; no release assets | English | No targeted app block | No targeted site block | Calendar planning | Work/check-ins | No | 10-second overlay emergency exit | Not found | Not found | No garden/rewards | 2026-08-19 |
| raviriley/Willpower | GPL-3.0 | No paywall in inspected code | Native macOS14+; v1.0.11 DMG; not run | Not found | No | Network block/allow lists | Yes | No | Visit-count trigger, not usage minutes | No routine early exit | No | No | No | 2026-03-11 |
| pratikkuikel/distraction-free | MIT | No accounts/backend | Swift native; v0.3.7 pkg/zip; not run | English | Not app selection | DNS categories | Fixed social time window | No | No | FAIL: deliberately fake disable countdown | Yes, reset on disable attempt | No | Quotes only | 2026-09-19 |

## Evidence and decisive gaps

### Focus

- [LICENSE](https://github.com/aowshad/Focus/blob/main/LICENSE), [source](https://github.com/aowshad/Focus/blob/main/js/app.js), [releases](https://github.com/aowshad/Focus/releases): latest v1.2.0 on 2026-07-08 with `Focus-1.2.0-mac.zip`; issues API returned empty.
- `js/app.js` contains localStorage persistence, streak calculation and heatmap rendering. `src-tauri/Cargo.toml` only native shell/tray/notifications dependencies. `index.html` contains English controls. No blocker implementation. Useful UX reference only.

### FocusCat

- [LICENSE](https://github.com/builder-group/focuscat/blob/develop/LICENSE) is AGPL even though GitHub's detected license is Other. [releases](https://github.com/builder-group/focuscat/releases) latest desktop-v0.0.50 2026-08-11, aarch64/x64 DMGs. Issue #16 asks how blocking levels apply; #15 Zen support closed.
- [blocker.rs](https://github.com/builder-group/focuscat/blob/develop/apps/desktop/src-tauri/src/features/blocking/blocker.rs) shows/hides an overlay over the frontmost application or site. It does not block the network. [resolution.rs](https://github.com/builder-group/focuscat/blob/develop/apps/desktop/src-tauri/src/features/focus_profile/resolution.rs) and `ActivationSettingGroup.tsx` implement day/time scheduling and profile categories.
- `features/timer/commands.rs` cancel/reset path immediately resets to idle and stops runner without a cooldown. No actual streak, XP, heatmap, achievement or allowance implementation found in active desktop features. Cat customization alone does not prove rewards for completed sessions.
- `activity_window/monitor.rs` uses `mado = 0.0.16`; App Store build explicitly disables browser/window metadata. Standalone release differs from App Store in capability.

### Ashdeck

- [pricing source](https://github.com/ashdeck/ashdeck/blob/main/src/pages/%28landing-page%29/pricing/index.tsx) explicitly describes Premium, annual renewal and lifetime purchase, and calls `https://api.ashdeck.com/subscriptions`.
- `AddList.modal.tsx`, `BlockLists.tsx` and sessions components call authenticated remote API endpoints. `public/extension/manifest.json` and `scripts/background.js` contain Chrome DNR blocking, but the core-free/no-account/local-only requirements already fail. No GitHub release assets. Issue/PR history inspected.

### SelfControl

- [COPYING](https://github.com/SelfControlApp/selfcontrol/blob/master/COPYING), [daemon](https://github.com/SelfControlApp/selfcontrol/blob/master/Daemon/SCDaemonBlockMethods.m), [Sentry](https://github.com/SelfControlApp/selfcontrol/blob/master/Common/SCSentry.m). No GitHub Releases API entries; distribution uses official website.
- PF+hosts daemon reasserts blocks. README explicitly says timer cannot be undone even by restart/deletion. This is incompatible with requested routine safe emergency override, although recovery utilities exist.
- Sentry SDK is bundled; `beforeSend` and `EnableErrorReporting` gate transmission behind opt-in. This is not covert telemetry, but still differs from the requested no-analytics-SDK baseline.
- Open issue #931 requests application blocking; #934 requests multiple saved profiles. Chinese text exists as a loose strings file, not proof of complete packaged Chinese UI. No progress/game mechanics.

### Newer alternatives

- [HanuFocus](https://github.com/thesrivamshi/HanuFocus): MIT checked; no GitHub release or issues. `OverlayCoordinator.swift` supplies a real 10-second emergency close. `BrowserHistory.swift` reads copied history for local accountability, not website prevention. Thus wrong enforcement primitive despite current activity and attractive local-first design.
- [Willpower](https://github.com/raviriley/Willpower): GPL checked; v1.0.11 on 2026-03-10. Native daemon, network blocking, weekday picker and visit triggers are present. Open #12 requests non-network blocking; #13 requests disturbing app blocking. README warns newer macOS is buggy, VPN/proxy limitations and disabling Private Relay. No gamification or complete Chinese. Not selected.
- [distraction-free](https://github.com/pratikkuikel/distraction-free): MIT checked; v0.3.7 2026-09-19. `macos/Sources/dfmenubar/AppState.swift:186` records disable attempt and resets streak, never stops daemon. UI misleadingly promises 24h; README admits countdown is fake. Root DNS LaunchDaemon and manual uninstall; incompatible with truthful and safe exit and nonpunitive rewards. Rejected without installation.
- `anaygoyal09/Focus`: GitHub license is null; no explicit open-source permission proven, excluded from shortlist.

## Reusable MIT native layer

The strongest discovery is [Abstand's independently MIT-licensed mado crate](https://github.com/builder-group/abstand/tree/develop/crates/mado), version 0.0.21 at commit `a56fabd30593f338e034f9d4497fd0a3e359987e`. Its own LICENSE is MIT, copyright 2024 @bennobuilder, independently of the root AGPL application.

`src-swift/BrowserInfo.swift`, `BrowserWebContent.swift`, `SafariWebContent.swift`, `BrowserURLExtractor.swift`, `SupportedBrowsers.swift`, `WindowMonitor.swift` and `InstalledApps.swift` provide native Accessibility observation and installed application identities. Safari/Chrome/Edge are explicitly covered. This uses AX APIs, not AppleScript or browser extensions. Current version prioritizes loaded document URL, and rejects edited/unreadable address-bar state to avoid confusing typed text with the current website. Swift package 6.1 with pinned swift-rs. Preserve its MIT attribution when reusing. Do not copy AGPL FocusCat overlay code into an MIT product without complying with AGPL.

Conclusion: no audited candidate meets all hard requirements. Prefer Focuser's existing MIT data/rule/calendar/allowance/i18n foundation plus independently licensed native observation and a safe local reward/session layer. Native compatibility, enforcement, exports and persistence remain runtime acceptance work, not inferred PASS from this research.
