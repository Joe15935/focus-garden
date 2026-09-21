# 专注花园 · Focus Garden

独立、本地优先的 macOS 中文专注应用。以 [Focuser](https://github.com/aadeshrao123/Focuser) v0.7.3 的 MIT 开源规则引擎、日程、额度、SQLite 和编辑器为基础，新增真实计时、三档退出约束、成长花园和 Mac 原生适配。

**当前版本：0.1.0，早期验证版。** 已在 Apple Silicon Mac 上构建和实测。自动化测试 457 项通过；本机功能验收 20 项通过，整机重启验收尚未完成。现阶段请从源码构建，尚无经 Apple 公证的公开安装包。Windows、Linux 和 Intel Mac 不在本版本验证范围内。

**费用**：无订阅、无 Pro、无账号、无云服务、无广告、无追踪。全部功能均无付费解锁；应用自有代码和 Focuser 底座采用 MIT 许可，第三方依赖保留各自开源许可证。仅本机运行。实际功能验收范围见 [验收记录](docs/TEST_RESULTS.md)。

## 使用

打开 `Focus Garden.app`。在设置中按用途授予辅助功能以及 Safari / Chrome / Edge 的自动化权限。创建屏蔽列表，通过应用图标或网址规则选择目标；再回首页开始专注。

Safari 首次跳转到本机提示页时，可能显示“确认要加载的文件”。确认文件为本应用的 `focus-garden-blocked.html` 后打开；本机后续重复访问已验证能自动拦截。整机重启后的行为仍以验收记录为准。

- 温和：随时提前结束。
- 专注：申请结束后等待30秒，填写原因。
- 深度专注：等待5分钟，填写原因并输入确认文字。
- 完成实际专注获得XP与植物进度，提前结束不扣已有成果。
- 网站命中后跳到本机中文提示页；应用命中后暂时隐藏其窗口，不结束进程、不丢未保存内容。

详细文档：[中文使用说明](docs/使用说明.md)、[数据与恢复](docs/数据与恢复.md)、[验收记录](docs/TEST_RESULTS.md)、[候选研究](docs/RESEARCH.md)。验收记录是功能状态的依据，不能从 README 宣称直接推导实机 PASS。

## 从源码构建

需要 Apple Silicon Mac、macOS13+、当前稳定版 Rust（通过 rustup 安装）、Node.js20+和安装在 `/Library/Developer/CommandLineTools` 的 Apple 命令行开发工具。

```sh
git clone https://github.com/Joe15935/focus-garden.git
cd focus-garden
```

```sh
./scripts/build-macos.sh
```

构建产物 `target/release/bundle/macos/Focus Garden.app`。脚本仅在自身进程中选择命令行SDK，不修改系统Xcode选择。不需要付费签名证书；本机使用临时签名，未公证，不是面向大众分发的签名安装包。

验证：

```sh
./scripts/check.sh
```

第一次验证前，请在 `crates/focuser-ui/frontend` 执行 `npm ci`，并执行 `rustup component add llvm-tools`。构建脚本会安装锁定的前端依赖和 Rust LLVM 开发工具，需要联网；安装后的专注功能和数据存储均在本机运行。

## 结构与上游兼容

保留 `crates/focuser-common` / `focuser-core` / `focuser-app` 的模块结构。独立的 `focuser-core/src/garden.rs` 管理计时与奖励；`focuser-ui/src/mac_guard.rs` 适配Mac；`garden_bridge.rs` 统一桌面安全边界。旧版 hosts、杀进程循环、无鉴权HTTP服务及自动更新器不编入桌面入口。

上游固定提交 `c49a980f4b2b9c09c4520001a0cdc4f11466feff`；上游源码及提交历史可从原项目获取。原说明在 [UPSTREAM_README.md](docs/UPSTREAM_README.md)。第三方归属见 [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES)。应用层不复制AGPL的FocusCat/Abstand代码，仅复用独立MIT的mado原生库。

公开仓库从完整源码快照开始，保留上述固定底座的出处、归属与许可证。本机部署记录和上游旧扩展示例中无法确认用途的凭据格式内容不进入公开历史；原始上游历史仍可从 Focuser 获取。本机私人验收日志、会话导出、系统状态及个人提交邮箱不会上传。上游旧 CI 和自动发布流程保存在 [docs/upstream-workflows](docs/upstream-workflows/)，作为历史参考，不会自动运行。贡献说明见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 安全边界

这是一款增加临时反悔成本的自律工具。运行中才执行限制，用户仍可通过系统强制退出或撤销权限恢复。不开root服务，不改hosts/代理/SIP/FileVault/Recovery，不阻止系统恢复，不删除其他软件。浏览器后台标签的网络和音频不作为全局网络防火墙处理。首次授权、系统实际重启等必须实测后才可判PASS。
