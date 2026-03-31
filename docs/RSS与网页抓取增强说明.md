# RSS 与网页抓取增强说明

更新时间：2026-03-31

## 这轮改了什么

### 1. RSS 发现更接近成熟订阅器

- 输入站点 URL 时，不再只靠常见 `/feed` 路径猜测。
- 现在会额外解析页面里的 `<link rel="alternate">`，自动找出真实 feed。
- 候选结果会返回：
  - 站点 host
  - favicon / icon
  - 最近样本标题
  - 最近发布时间
  - 命中原因与置信度

这让“站点 URL → 一键订阅”更接近 Folo 这类成熟产品的感受。

### 2. RSS 抓取不再停留在标题 + 片段

- `smart / full` 档位现在会在抓取阶段尝试补正文。
- 对 S/A 级源也会给出正文预抓预算。
- 新增落表字段透传：
  - `fetchEngine`
  - `renderMode`
  - `blockedReason`

这样阅读页可以直接看出这条内容是：

- 纯 RSS 正文
- 原生网页补全
- Scrapling 动态兜底
- 后续 browser-assist 兜底

### 3. OPML 导入补了真正去重

以前 OPML 导入对重复源几乎没有可靠保护；现在按 source fingerprint 去重，同一批 feed 重复导入只会记为 `skipped`。

### 4. 网页更新 / 网页正文补了 browser-assist 适配层

系统新增了一个可选的 `browser-assist` HTTP 适配层：

- `BROWSER_ASSIST_ENABLED`
- `BROWSER_ASSIST_URL`
- `BROWSER_ASSIST_TOKEN`
- `BROWSER_ASSIST_PROVIDER`
- `BROWSER_ASSIST_TIMEOUT_MS`

主链路现在是：

`native -> scrapling -> browser-assist`

这意味着后面你要接：

- 自己的 Playwright 抽取服务
- 基于 `web-access` CDP proxy 做的桥接服务
- 其他浏览器自动化 skill

都不用再改主抓取逻辑。

## 为什么没有把 Agent-Reach / web-access 直接写死进核心代码

这是一个刻意的边界：

- `Playwright / web-access` 更适合做“浏览器能力提供者”，可以走 HTTP bridge 进热路径。
- `Agent-Reach` 更像“多渠道联网脚手架”，适合做研究助手、一次性采集、人工触发型任务，不适合直接成为在线 RSS/网页抓取的硬依赖。

所以当前架构判断是：

- **热路径依赖**：稳定 HTTP 适配器
- **侧车能力**：Agent-Reach / web-access / 手工 Playwright 工作流

这样可维护性更高，也不会把运行时绑死在某个第三方 skill 的内部实现上。

## 建议你下一步怎么接

### 方案 A：先不接外部 skill

直接使用当前：

`native -> scrapling`

适合大多数公开网页与 RSS 正文补全。

### 方案 B：接一个 browser-assist 服务

最推荐。你只要提供一个 HTTP 服务，至少实现：

- `POST /extract/article`
- `POST /extract/snapshot`
- `GET /health`

返回结构尽量对齐现有 `scrapling`：

- `title`
- `content`
- `html`
- `renderMode`
- `blockedReason`

这样 InfoHub 会自动把它接进正文补全和网页快照兜底链路。

### 方案 C：把 web-access 当成 browser-assist 的底层

这是比较稳的做法：

1. `web-access` 负责 CDP/浏览器能力
2. 你写一个很薄的 bridge service，把页面正文提取成统一 HTTP 响应
3. InfoHub 只认识这个 bridge，不直接耦合 `web-access` 的实现细节

### 方案 D：把 Agent-Reach 当研究助手

更适合：

- 搜平台内容
- 看 YouTube / Reddit / X / GitHub
- 一次性采集
- 带登录态的复杂信息获取

不建议直接挂到在线 RSS 抓取热路径。

## 本轮已验证

- `services/hub-engine npm run build` 通过
- `apps/web npm run build` 通过
- 真实 API 回归：站点 URL `https://www.bmpi.dev/` 能发现 alternate feed，并返回 host/icon/sample/latestPublishedAt
- 真实容器内抓取回归：`full` 档位 RSS 会触发正文补全，返回 `fetchEngine=native`
- OPML 重复导入回归：首次 `imported=1`，第二次 `imported=0 / skipped=1`
