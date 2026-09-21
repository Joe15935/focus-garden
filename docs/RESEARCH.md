# 候选验证与路线决策

核查日期 2026-09-21。环境 macOS 26.6.2 / arm64，Safari、Google Chrome、Microsoft Edge 已安装。

结论 **FORKED_AND_EXTENDED**。本次检索和源码检查范围内，没有项目同时满足全部硬条件，不能标为 FOUND_EXISTING。研究阶段没有运行这些第三方阻断器；下表的“是”只表示已审查源码或正式发布物支持该能力，不是本机运行验收 PASS。所有候选的本机阻断可靠性、实际中文显示、资源占用与重启行为均未验证。

证据入口：[四个候选的许可证、固定提交与源码定位](RESEARCH_FOUR.md)；[其他候选与扩展搜索的源码证据](RESEARCH_BROADER.md)。各项目名称后的“证据”链接定位到相应章节。Focuser 的固定底座和取舍见下方独立说明。

表内口径：**是**＝已有对应源码/发布物证据；**否**＝在本次检查范围内没有对应实现，或明确违反该硬条件；**部分**＝已有能力但范围不足；**未验证**＝证据不足，不能替代“是”。“完全免费”以检查时的全部核心功能门槛为准，不把开源许可证等同永久免费承诺。最近维护统一使用最后 push 日期，不混用 Release 日期。

| 项目 | License | 完全免费 | Mac | 中文 | App封锁 | 网站封锁 | 周计划 | Pomodoro | 每日额度 | Strict | Streak | 成就 | 趣味性 | 最近维护 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| [Focuser](https://github.com/aadeshrao123/Focuser) | MIT | 是，已审代码无付费门槛 | 是，双架构 Release；本机未验证 | 部分，有 zh 资源，实际覆盖未验证 | 部分，有实现但 Mac 路径/ID 匹配缺口 | 部分，扩展/hosts；Safari 支持缺口 | 是 | 部分，有番茄钟但跳过可错误记整段 | 是 | 部分，有锁定但出口不符合要求且可绕过 | 否，未见实现 | 否，未见实现 | 部分，拦截文案；无成长奖励 | 2026-07-29 |
| [Orilo](https://github.com/imanabdulm/Orilo-App) · [证据](RESEARCH_FOUR.md#orilo-source-evidence) | MIT | 是，已审代码仅捐赠 | 是，SwiftUI/macOS 14+；本机未验证 | 否，英文硬编码 | 部分，overlay/hide；4 秒即可继续 | 否 | 否 | 是 | 否 | 否，End/Pause 可直接操作 | 是，当前/最长连续天数 | 部分，有限里程碑提示 | 部分，Focus Proof/里程碑；无花园成长 | 2026-07-19 |
| [Abstand](https://github.com/builder-group/abstand) · [证据](RESEARCH_FOUR.md#abstand-source-evidence) | AGPL-3.0-only | 部分，当前未见付费门槛；明确规划买断及更新收费 | 是，Tauri/Swift，arm64+x64 Release；本机未验证 | 否，未见中文资源 | 是，窗口 overlay | 是，浏览器 overlay；实际可靠性未验证 | 是 | 否，Break 仍为未来计划 | 否 | 部分，三档 enforcement；安全恢复实机未验证 | 否 | 否，奖励仍为未来概念 | 否，当前缺完成后的成长机制 | 2026-09-12 |
| [Fence](https://github.com/VishalJ99/fence) · [证据](RESEARCH_FOUR.md#fence-source-evidence) | GPL-3.0 | **否，试用+联网授权+购买入口** | 是，Objective-C 原生，支持 arm64 构建；本机未验证 | 部分，旧 zh-Hans；新计划/授权 UI 仍英文 | 是 | 是，hosts/PF | 是 | 否，未见实现 | 否，只有每日休息次数额度，并非 App/网站使用时长 | 是，存在 Emergency Exit 源码；本机未验证 | 否，未见实现 | 否，未见实现 | 否，未见正反馈成长机制 | 2026-09-08 |
| [StandLock](https://github.com/yagizdo/standlock) · [证据](RESEARCH_FOUR.md#standlock-source-evidence) | MIT | 是，已审代码仅捐赠 | 是，Swift/macOS 13+；本机未验证 | 否，只有英语/土耳其语 | 否，无指定 App 限制 | 否 | 部分，休息日程 | 部分，工作/休息重复循环 | 否，只有跳过休息次数额度 | 部分，休息时锁输入并有紧急组合键，不是专注 App/网站锁 | 部分，记录休息连续天数 | 否，未见实现 | 部分，退出小游戏含转盘/调侃，不符合本任务反馈设计 | 2026-09-19 |
| [Focus](https://github.com/aowshad/Focus) · [证据](RESEARCH_BROADER.md#focus) | MIT | 是，已审运行代码无付费/云端要求 | 是，Tauri arm64 Release；本机未验证 | 否，英文 UI | 否 | 否 | 否 | 是 | 否 | 否 | 是 | 否，未见实现 | 部分，连续天数与热图；无阻断后的成长闭环 | 2026-07-08 |
| [FocusCat](https://github.com/builder-group/focuscat) · [证据](RESEARCH_BROADER.md#focuscat) | AGPL-3.0-or-later（Cargo 声明） | 是，已审本地核心无付费/账号门槛 | 是，arm64+x64 Release；本机未验证 | 否，英文 UI | 是，前台窗口 overlay | 是，前台 URL overlay；不是网络封锁 | 是 | 是 | 否，未见实现 | 否，取消/重置可立即恢复空闲 | 否，未见实现 | 否，未见实现 | 部分，猫外观自定义；未见由完成专注解锁成长 | 2026-08-12 |
| [Ashdeck](https://github.com/ashdeck/ashdeck) · [证据](RESEARCH_BROADER.md#ashdeck) | AGPL-3.0 | **否，Premium 年费/买断和远端 API** | 部分，浏览器扩展；无原生 Mac 应用证据 | 未验证，未找到完整中文证据 | 否 | 是，Chrome DNR 源码 | 部分，有日程源码；完整周计划未验证 | 是 | 未验证 | 未验证 | 未验证 | 未验证 | 部分，声音/壁纸；完成专注奖励未验证 | 2026-06-24 |
| [SelfControl](https://github.com/SelfControlApp/selfcontrol) · [证据](RESEARCH_BROADER.md#selfcontrol) | GPL-3.0 | 是 | 是，原生 macOS；本机未验证 | 未验证，仅散落中文字符串，无完整打包 UI 证据 | 否 | 是，PF+hosts | 否，未见核心周计划 UI | 否，只有倒计时 | 否 | 否，不具备要求的常规安全提前退出；恢复工具不等于该功能 | 否 | 否 | 否 | 2026-06-26 |
| [HanuFocus](https://github.com/thesrivamshi/HanuFocus) · [证据](RESEARCH_BROADER.md#newer-alternatives) | MIT | 是，已审代码无付费要求 | 是，SwiftUI/arm64/macOS 14+ 源码；无 Release 资产，本机未验证 | 否，英文 UI | 否，无指定 App 阻断 | 否，读浏览器历史不等于阻断 | 部分，日历规划 | 部分，工作签到流程 | 否 | 部分，overlay 有 10 秒紧急退出；无 App/网站限制 | 否，未见实现 | 否，未见实现 | 否，未见花园/奖励 | 2026-08-19 |
| [Willpower](https://github.com/raviriley/Willpower) · [证据](RESEARCH_BROADER.md#newer-alternatives) | GPL-3.0 | 是，已审代码无付费门槛 | 是，原生 macOS 14+、DMG；本机未验证，上游提示新版系统问题 | 未验证，未找到完整中文证据 | 否 | 是，网络黑/白名单 | 是 | 否 | 否，访问次数触发不等于使用分钟额度 | 否，无要求的常规提前退出 | 否 | 否 | 否 | 2026-03-11 |
| [distraction-free](https://github.com/pratikkuikel/distraction-free) · [证据](RESEARCH_BROADER.md#newer-alternatives) | MIT | 是，已审代码无账号/后端 | 是，Swift 原生、pkg/zip；本机未验证 | 否，英文 UI | 否，无 App 选择 | 部分，DNS 分类限制 | 部分，固定社交时间窗 | 否 | 否 | **否，关闭倒计时为虚假交互，不实际停止守护进程** | 部分，尝试关闭即重置；不符合温和奖励要求 | 否 | 部分，语录；无真实完成奖励 | 2026-09-19 |

以上“未见实现”的否定仅针对固定版本及已检查模块，不扩展为项目永远不会支持。所有候选均至少有一个明确硬条件缺口，因此无需把未验证项猜成 PASS 才能作出不直接安装的决定。

## 为什么复用 Focuser

以 c49a980f4b2b9c09c4520001a0cdc4f11466feff 为固定底座（v0.7.3）。本机开发目录保留上游 Git 历史及 upstream remote；研究与本机部署阶段未发布，当前公开仓库以独立源码快照发布并保留底座出处和许可证。MIT允许修改与自行编译。复用匹配模型、SQLite、计划、额度、编辑器和中文资源。核心165项单元测试及1项文档测试在本机命令行SDK下通过。

关键风险由源码定位：未鉴权HTTP和CORS *；hosts整文件覆盖；无扩展时默认杀浏览器；Mac bundleID/path匹配缺口；跳过番茄可记整段；严格锁与退出路径不一致。故上述桌面运行时不编入Focus Garden，不以切换开关掩盖。

另复用独立 MIT 的 [mado](https://github.com/builder-group/abstand/tree/develop/crates/mado) 0.0.21，读取 macOS 前台应用/网址。Abstand/FocusCat应用其余AGPL源码不复制。保持 mado 的 MIT attribution。

最低版本闭环为原生规则读取与安全拦截、有限专注计时、后端严格退出、持久化奖励；再加入中文花园、装扮、成就、热力图、导出及测试。macOS辅助功能和浏览器自动化权限须由用户亲自授予，未授权不能宣称实机拦截通过。

## 搜索覆盖

使用 agent-reach GitHub CLI、Exa与网页搜索。覆盖 open source macOS focus app、open source macOS app blocker、macOS distraction blocker open source、open source productivity gamification、gamified focus app open source、Pomodoro streak achievements open source、digital wellbeing open source macOS、Chinese macOS focus blocker、GitHub self control macOS、open source Cold Turkey alternative。扩展检索与原始来源见 [其他候选报告](RESEARCH_BROADER.md)，包括 Willpower、HanuFocus、distraction-free 等。不是对互联网所有项目不存在的数学证明，而是本次可复核证据范围内的结论。

## 随附许可证材料的核验状态

**发行随附文档准备：PASS；所有依赖精确版本的许可证全文核验：PARTIAL。** 这两个状态不能合并为无条件的法律或发行保证。最终安装包是否确实带齐资源，仍需在打包后核验。

[项目 LICENSE](../LICENSE) 保留 Focuser 的 MIT 著作权及许可条款，并列出 Focus Garden 修改的署名。[THIRD_PARTY_NOTICES](../THIRD_PARTY_NOTICES) 保留 Focuser、独立 MIT 的 mado、SwiftRs 的原许可和补丁说明；依赖未统一改标为 MIT。[完整清单](licenses/INVENTORY.md) 与 [机器可读证据](licenses/inventory.json) 区分 233 个 Rust 运行路径依赖、78 个构建/proc-macro 依赖，以及 110 个前端依赖/样式/生成代码来源。5 个 MPL 组件的精确源码归档、Inter 字体的 OFL、原始许可文本和校验值均随附；检查的目标依赖声明中未发现 GPL/AGPL。此结论不代表对所有上游代码作了无限范围许可证审计。

尚未完整核实的证据明确保留：

- `convert_case` 0.4.0 有 MIT 声明，但精确包/所查上游版本缺独立 LICENSE 全文。
- `fxhash` 0.2.1 与 `mac` 0.1.1 有 MIT/Apache-2.0 声明及源头/README 证据，但缺独立完整许可文件。已保留原声明、可取得的版权头及标准条款；这不应写成已找到原始全文。
- `react-remove-scroll-bar` 2.3.8 的 npm 包声明 MIT，但未携带 LICENSE，发布 gitHead 返回 404；补入的是已固定当前上游提交的原始 MIT 文本，不能冒充该发布版本已经逐字核验。

源码和本机交付附带现有许可材料及这些边界。再次分发时应保留 `LICENSE`、`THIRD_PARTY_NOTICES` 与完整 `docs/licenses`，并复核最终包中的对应资源；本报告没有省略已知全文缺口。
