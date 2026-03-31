# Codex Code Review 使用说明

更新时间：2026-03-31

## 结论

Codex 的 Code Review 分两种：

1. GitHub PR Review：针对 Pull Request，在 GitHub 里自动或手动触发审查。
2. 本地 Review：在 Codex App / IDE / CLI 里对当前 diff、commit 或分支做审查。

如果你想实现“仓库里所有 PR 都自动被 Codex 审查”，重点不是本地 CLI，而是 **Codex Cloud + GitHub 集成**。

## 给自己仓库开启 PR 自动 Review

以 `ReiseReise/infohub` 为例，流程是：

1. 先完成 Codex Cloud 环境配置，并把 GitHub 仓库连接到 Codex。
2. 打开 Codex 的 Code review 设置页：`https://chatgpt.com/codex/settings/code-review`
3. 在仓库级别打开 `Code review`
4. 再打开 `Automatic reviews`
5. 之后新建 PR；Codex 会在 PR 进入 review 状态时自动给出 GitHub review

如果你不想每个 PR 都自动审，可以只开 `Code review`，不开 `Automatic reviews`。这样在 PR 评论区手动发一条：

```md
@codex review
```

Codex 会像同事一样回复标准 GitHub code review。

## 怎么让 Codex 审得更像你的团队

在仓库根目录放一个 `AGENTS.md`，增加：

```md
## Review guidelines

- 检查认证中间件是否覆盖所有管理接口。
- 发现会导致 API 地址错误的协议变更时，按高优先级提出。
- 关键变更必须要求测试、lint 或构建证据。
```

Codex 会读取离变更文件最近的 `AGENTS.md`。如果某个子目录需要更细的规则，可以在子目录再放一份更具体的 `AGENTS.md`。

## 本地 /review 什么时候用

如果你还没发 PR，只想先在本地做一次“预审”，可以在 Codex App / IDE / CLI 中用 `/review`：

- review 当前改动
- review 某个 commit
- review 相对某个基线分支的差异

这更像“提交前自检”；GitHub PR Review 更像“协作流程中的正式审查”。

## 你现在最该做的

1. 登录 `chatgpt.com/codex`
2. 连接 `ReiseReise/infohub`
3. 打开 `Code review`
4. 决定是“全自动审”还是“手动 `@codex review`”
5. 给仓库补一份明确的 `AGENTS.md` 审查规则

## 官方参考

- Codex GitHub 集成：<https://developers.openai.com/codex/integrations/github>
- Codex Quickstart：<https://developers.openai.com/codex/quickstart/>
- Codex Best practices：<https://developers.openai.com/codex/learn/best-practices/>
