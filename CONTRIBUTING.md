# 为专注花园贡献

Focus Garden 是基于 Focuser 的独立 MIT 项目，目前验证范围为 Apple Silicon macOS。请保持上游模块边界，提交小而可审查的修改，保留第三方归属和原许可证。

## 开发与验证

先按 [README](README.md) 安装开发工具和前端依赖。提交前执行：

```sh
./scripts/check.sh
```

该脚本包含 Rust 格式检查、Clippy、workspace 测试、前端类型检查、测试与构建。涉及桌面打包时还需执行：

```sh
./scripts/build-macos.sh
```

应用/网站限制、权限、退出流程和视觉修改需要使用构建后的应用实测，记录真实 PASS/FAIL 及未覆盖范围。不要为了测试锁住恢复工具或修改系统安全设置。

## 提交内容

- 针对 Focus Garden 的问题或改动，请提交到本仓库的 Issues 或 Pull Requests。
- 提交前排除个人会话、数据库、屏蔽记录、浏览器历史、系统状态、凭据及原始验收日志；`evidence/` 默认忽略。
- 说明触发条件、预期行为、实际结果和最小复现；日志只提供必要且已脱敏的片段。
- 保持本地优先，不引入广告、追踪、付费解锁或账号依赖。
- 新增或升级依赖时同步更新第三方许可清单，不能将第三方代码重新标为项目自有 MIT 代码。

上游原贡献说明保存在 [UPSTREAM_CONTRIBUTING.md](docs/UPSTREAM_CONTRIBUTING.md)，旧工作流保存在 [upstream-workflows](docs/upstream-workflows/)。它们是历史参考，尚未作为 Focus Garden 的多平台 CI 或自动发布流程启用。

贡献的应用代码遵循项目 MIT 许可；第三方部分继续遵循原许可。
