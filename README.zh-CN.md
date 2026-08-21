# Memmy：Codex 与 Claude Code 共享记忆

这是基于 [MemTensor/memmy-agent](https://github.com/MemTensor/memmy-agent) 的本地优先分支，目标是让 **Codex** 与 **Claude Code** 共享一套可审计、可纠正的开发记忆。

## 当前范围

- 扫描 Codex 与 Claude Code 的本地历史会话并整理为记忆。
- 为两者安装 `memmy-memory` Skill 与自动采集 Hook。
- 在 macOS 菜单栏应用中启动本地服务、配置模型 API Key、查看和管理记忆。
- 支持 DeepSeek 等兼容模型作为 BYOK 推理供应商；DeepSeek 不是需要同步历史的 Agent。

内部 WebSocket 只用于桌面界面与本地 Agent Runtime 通信，不属于第三方消息渠道。

## 开发

```bash
npm install
npm run build
npm test
```

主要目录：

- `App/backend`：本地 API、历史扫描、记忆读写、Skill 与 Hook 安装。
- `App/frontend/desktop`：桌面管理界面。
- `App/memmy-agent`：本地 Agent Runtime 与内部 WebSocket。
- `App/shell/desktop`：macOS Electron 壳与菜单栏入口。

## 上游同步策略

上游仓库保留为 `upstream` remote。同步时只移植 Codex、Claude Code 的兼容性改进，以及记忆正确性、数据库、本地 API、BYOK、macOS 生命周期、安全和性能等全局修复。

## 隐私

记忆与配置默认保存在本机。API Key 不应提交到 Git；请通过桌面设置或本地环境变量配置。

## License

沿用上游项目许可证，详见 [LICENSE](LICENSE)。
