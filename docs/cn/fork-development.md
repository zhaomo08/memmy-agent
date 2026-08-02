# Fork 开发与上游同步

本 Fork 采用三层分支策略，避免个人优化阻塞上游同步：

- `main`：只镜像 `MemTensor/memmy-agent:main`，不直接提交定制代码。
- `develop`：集成已经验证的个人优化。
- `agent/*`、`feature/*`：每项优化使用独立分支，通过 PR 合入 `develop`。

Fork 的默认分支设置为 `develop`。这样新功能 PR 默认进入我们的集成分支，同时
定时同步工作流可以保存在 `develop`，不会向镜像分支 `main` 注入定制提交。

## Remote 配置

```bash
git remote -v
```

预期配置：

```text
origin    https://github.com/zhaomo08/memmy-agent.git
upstream  https://github.com/MemTensor/memmy-agent.git
```

## 同步上游 main

GitHub Actions 每天自动检查一次，也可以在 Actions 页面手动运行
`Sync upstream main`。工作流只允许快进更新；如果 Fork 的 `main` 出现个人提交或
历史分叉，它会失败并停止，不会强制覆盖。

本地可以执行：

```bash
./scripts/sync-upstream.sh
```

## 将上游更新集成到 develop

不要直接把上游内容推入 `develop`。先创建独立同步分支：

```bash
./scripts/sync-upstream.sh --prepare-develop
```

脚本将：

1. 快进同步 Fork 的 `main`；
2. 从最新 `develop` 创建 `sync/upstream-<sha>`；
3. 将 `main` 合并进同步分支；
4. 保留同步分支供测试和代码检查。

验证通过后再推送同步分支，并创建目标为 `develop` 的 PR。存在冲突时在同步分支
解决，`main` 和 `develop` 都不会被强制改写。

## 开发新功能

```bash
git switch develop
git pull --ff-only origin develop
git switch -c agent/<feature-name>
```

完成代码和测试后推送功能分支，并创建目标为 `develop` 的 Draft PR。确认改动稳定
后再决定是否向原项目提交独立的上游 PR。
