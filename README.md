# 专注花园 · Focus Garden

独立、本地优先的 macOS 中文专注应用。以 [Focuser](https://github.com/aadeshrao123/Focuser) v0.7.3 的 MIT 开源规则引擎、日程、额度、SQLite 和编辑器为基础，新增真实计时、三档退出约束、成长花园和 Mac 原生适配。

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

需要 Apple Silicon Mac、macOS13+、Rust、Node.js20+和Apple命令行开发工具。复用了现有开发环境，不安装后台服务。

```sh
./scripts/build-macos.sh
```

构建产物 `target/release/bundle/macos/Focus Garden.app`。脚本仅在自身进程中选择命令行SDK，不修改系统Xcode选择。不需要付费签名证书；本机使用临时签名，未公证，不是面向大众分发的签名安装包。

验证：

```sh
./scripts/check.sh
```

## 结构与上游兼容

保留 `crates/focuser-common` / `focuser-core` / `focuser-app` 及上游 Git 历史。独立的 `focuser-core/src/garden.rs` 管理计时与奖励；`focuser-ui/src/mac_guard.rs` 适配Mac；`garden_bridge.rs` 统一桌面安全边界。旧版 hosts、杀进程循环、无鉴权HTTP服务及自动更新器不编入桌面入口。

上游固定提交 `c49a980f4b2b9c09c4520001a0cdc4f11466feff`；`upstream` remote 保留。原说明在 [UPSTREAM_README.md](docs/UPSTREAM_README.md)。第三方归属见 [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES)。应用层不复制AGPL的FocusCat/Abstand代码，仅复用独立MIT的mado原生库。

## 安全边界

这是一款增加临时反悔成本的自律工具。运行中才执行限制，用户仍可通过系统强制退出或撤销权限恢复。不开root服务，不改hosts/代理/SIP/FileVault/Recovery，不阻止系统恢复，不删除其他软件。浏览器后台标签的网络和音频不作为全局网络防火墙处理。首次授权、系统实际重启等必须实测后才可判PASS。
