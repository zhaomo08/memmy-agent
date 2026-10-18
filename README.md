# Memmy：Codex 与 Claude Code 共享记忆

这是基于 [MemTensor/memmy-agent](https://github.com/MemTensor/memmy-agent) 的本地优先分支，目标是让 **Codex** 与 **Claude Code** 共享一套可审计、可纠正的开发记忆。

## 当前范围

- 扫描 Codex 与 Claude Code 的本地历史会话并整理为记忆。
- 为两者安装 `memmy-memory` Skill 与自动采集 Hook。
- 在 macOS 菜单栏应用中启动本地服务、配置模型 API Key、查看和管理记忆。
- 支持 DeepSeek 等兼容模型作为 BYOK 推理供应商；DeepSeek 不是需要同步历史的 Agent。
- 不包含 ChatWise、OpenCode、OpenClaw、Hermes、WorkBuddy、Telegram 或其他消息渠道的适配代码。

内部 WebSocket 只用于桌面界面与本地 Agent Runtime 通信，不属于第三方消息渠道。

## 安装

从 [Releases](https://github.com/zhaomo08/memmy-agent/releases) 下载 `Memmy-*-arm64-unsigned.dmg`（仅 Apple Silicon），拖入「应用程序」。应用未签名，首次打开前执行：

```bash
xattr -dr com.apple.quarantine /Applications/Memmy.app
```

应用不会自动更新，新版本需手动下载替换。

## 开发

```bash
npm install
npm run build          # 先构建 Memory，再构建各 workspace
npm test               # 发布流程、Memory、各 workspace 与 Agent TUI 测试
npm run dev:desktop    # 本地启动桌面端（renderer :19000 + Electron）
```

- 打包过桌面应用后，`better-sqlite3` 会被重编为 Electron ABI；跑测试前先 `npm rebuild better-sqlite3`。
- 本地打包：`npm run package:mac:unsigned`，产物在 `App/shell/desktop/release/`。打包前清掉各 `dist/`，否则已删除的源码会残留在安装包里：

  ```bash
  rm -rf App/memmy-agent/dist Memory/dist App/backend/dist App/shell/desktop/dist App/frontend/desktop/dist
  ```

- 发布：推送 `v<package.json 版本>-fork.<n>` 形式的 tag（如 `v1.0.9-fork.1`），GitHub Actions（`.github/workflows/release-macos.yml`）会构建 DMG 并发布 Release。不用纯 `vX.Y.Z`，那是上游的 tag。

主要目录：

- `Memory`：记忆核心服务（采集、检索、L1/L2/L3 演化、存储）与 `memmy-memory` CLI。
- `Migrations`：本地数据与配置迁移。
- `App/backend`：本地 API、历史扫描、记忆读写、Skill 与 Hook 安装、Agent 规则同步。
- `App/frontend/desktop`：桌面管理界面。
- `App/memmy-agent`：本地 Agent Runtime 与内部 WebSocket。
- `App/shell/desktop`：macOS Electron 壳与菜单栏入口。

## 上游同步策略

上游仓库保留为 `upstream` remote。同步时只移植以下内容：

- Codex、Claude Code 的兼容性修复和功能改进。
- 记忆正确性、数据库迁移、本地 API、BYOK、macOS 生命周期、安全和性能等全局修复。

上游新增的其他 Agent、消息渠道或社交平台代码不会合入；若某个全局修复夹带这些改动，只抽取核心修复。

## 隐私

记忆与配置默认保存在本机。API Key 不应提交到 Git；请通过桌面设置或本地环境变量配置。

## License

沿用上游项目许可证，详见 [LICENSE](LICENSE)。
