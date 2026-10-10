# 我的信息半径

入口：主导航「我的信息半径」或 `http://localhost/radius`。复用信息中枢登录态，旧 `/api/radius-ui/` 自动跳转。

信息中枢保管信源及原文，私有 Meilisearch 提供全文索引，网页和只读 MCP 共用同一 API。主题是持续匹配的收藏条件；新增主题并不自动抓取全网或订阅未经选择的源。

## 日常使用

1. 在原信源管理页添加关注源。已支持的 RSS、RSSHub 路由、网页目录和自定义接口继续沿用原采集器。
2. 采集到的文章、正文和已有音频转写进入 Meilisearch，包括未读及被信息流过滤的内容。
3. 在信息半径输入关键词检索，也可以添加主题，填多个同义词和排除词。主题不限定信源时，会包含以后新增的关注源。
4. 默认页直接输入问题，可先点「先查资料」预览范围和候选，再发起回答。系统严格匹配关键词，从关注源选择最多 12 篇符合最低正文要求的材料，调用现有可信研究服务，在本页显示回答、引用、追问和历史。支持滚动天/周/月、日历上月/本月/上周/去年，以及明确的日期与主题范围；检索关键词可手动调整。趋势问题分别查询前后等长时段，每段最多 6 篇，两段均有资料才允许生成比较。信息流被过滤的文章也可作为资料，关注不代表认可。
5. 在「浏览与搜索」按关键词、来源和日期找文章。阅读复用信息流的正文转换、Markdown 排版和字号偏好；已有可用译文可以切换，点击「问这篇」限定本篇范围。引用打开已保存的证据快照。
6. 音视频阅读页显示转写缺口，可手动「转写这一期」，调用既有音频服务并沿用其费用配置。转写结束后，索引器下一轮自动收录；本轮没有批量启动付费转写。
7. 首页图表显示真实采集趋势、正文覆盖和来源分布；正文覆盖只表示存有文本，不保证每条都已取得完整文章。

公众号、抖音、即刻和 X 的具体账号仍需可用 RSS/接口或授权的转文字工作流。没有接入的账号不会被视作已覆盖；关注列表本身不会被自动读取。已有采集器得到全文后不需要再单独配置搜索索引。视频/音频的转写仍使用原音频服务及其费用开关。

## 索引更新

- 固定版本 Meilisearch `1.54.0`，仅绑定 `127.0.0.1:7700`，不开公网。
- `radius-indexer` 常驻运行，每轮完成后间隔 300 秒开始下一轮。
- 采用每批 200 篇的全库核对，不依赖现有文章表中缺失的 `updated_at`，所以能捕捉后来补齐的正文与转写。
- 每批等待 Meilisearch 任务实际成功，全部完成后才清理已不在原库/有效来源范围内的派生索引副本；不删除 PostgreSQL 原文。
- 失败写入同步状态并保留原索引；下一轮可恢复。数据库级锁防止多个同步进程互相覆盖。
- 主题匹配基于关键词/短语，不等同于语义向量检索。搜索使用 Meilisearch 的中文分词与相关度排序，没有启用外部 embedding 或 LLM。
- 主题调整在下一轮同步后反映到历史结果。界面会提示规则尚未同步。
- 一篇文档保留标题、正文/转写、作者、信源、原文链接、发布时间、采集时间及内容哈希。正文分为已提取正文、完整性待核实的已存文本、转写、短内容和音视频简介；短内容及未转写音视频不用于问答。缺少发布时间时保留空值，不能用采集时间冒充发布日。浏览器可明确切换日期依据；宽泛匹配只用于浏览，不进入问答。

## Agent 接口

任何支持 stdio MCP 的客户端可以运行：

```json
{
  "command": "bash",
  "args": ["<项目绝对路径>/scripts/radius/agent.sh"]
}
```

工具：`radius_evidence`、`radius_search`、`radius_read`、`radius_topics`、`radius_sources`、`radius_status`。Agent 先用 `radius_evidence` 取得问题范围与候选，再用 `radius_read` 读取原文。证据工具不调用模型。

桥接使用独立只读密钥，固定到现有主资料账号；它不能更改主题/信源、查看提问历史、进入其他 API，也不能发起付费研究。密钥在 `~/Library/Application Support/AIReise/secrets/I10/radius-reader-key`，不进入客户端配置正文、共享目录或日志。轮换该文件后后端下一次请求即读取新值。

搜索调用是 `POST /api/radius/search`（虽然用 POST，它只检索）；正文为 `GET /api/radius/items/:id`，支持 offset 分段读取。浏览器仍使用原有 JWT 登录，并可维护主题。本机 Hermes 已注册 `infohub-radius` 六个只读工具；新会话自动加载，已有会话可用 `/reload-mcp`。原生工具发现和只读调用分别验收，不据此声称模型回答已通过。远程 Notion AI 仍需单独接通，不暴露本机 Meilisearch 主密钥。

## 本机部署与回退

数据库增量在 `001-radius.sql`：只在原 `hub.user_settings` 增加 `radius_topics` JSONB 字段，并增加单例同步状态表 `hub.radius_sync`。没有新建第二套信源表、原文库或用户体系；现有数据可见性保持原账号范围。

运行数据位于 `local-data:I10/runtime/meilisearch`，本机部署参数在 `local-data:I10/runtime/radius-deployment/runtime.env`。Meilisearch 密钥位于 I10 本机 secrets 目录。控制文件不含真实密钥。

```bash
# 常用状态/日志入口；封装当前正式 overlay，避免遗漏新服务配置
bash scripts/radius/compose.sh ps
bash scripts/radius/compose.sh logs --tail 20 radius-indexer
```

9/29 体验更新已发布完整主前端，`/radius` 与侧栏同步可见。后端以原已运行镜像为基础，只覆盖 radius 模块及必要的研究路由、资料快照和模型价格有效期文件。本轮没有数据库迁移。旧独立入口由 Nginx 重定向到主页面；独立 HTML 移到 `apps/web/standalone/`，避免开发服务器把 `/radius` 解析为独立页面。

直接问答沿用现有 DeepSeek 与每次预算上限，不启用全网扩搜。价格依据 [DeepSeek 官方价格页](https://api-docs.deepseek.com/quick_start/pricing) 于 2026-09-29 核对、10/2 真实验收前再核对，保留原有效期至 2026-10-06；到期仍按现有保护逻辑拒绝新任务。10/2 已在明确授权下完成一次固定 12 篇公开材料的真实问答：同一任务含修订与核对共 15 次调用，保守估算 ¥1.118094，低于 ¥10 上限，供应商账单未核对。正式页面回答、引用快照和手机布局通过；单例不代表普遍回答质量，Hermes 模型问答与真实音频转写仍待验证。

10/2 Hub 与 Nginx 当前镜像为 `infohub-radius-engine:radius20261002-qa2` 与 `infohub-radius-nginx:radius20261002-qa2`；索引器继续运行 `infohub-radius-engine:radius20261002`。正式更新与验证结果以 [36 号状态](../../docs/36-信息中枢V3可信可用收口任务跟踪.md) 为准。`radius20261002`、`radius20261002-qa1` 及前一版 `ux20260929-final` 镜像保留，原索引器为 `20260929`。配置前像位于 `local-data:I10/runtime/radius-deployment/`：初始优化为 `before-radius-20261002-runtime.env`，本次两次修复分别为 `before-radius-paid-fix-runtime.env`、`before-radius-verification-runtime.env`。Hermes 前像保存在 `local-data:I10/staging/radius-20261002/hermes-config-before.yaml`，只撤回新增 MCP 项，不覆盖之后的其他配置变更。回退本轮问答修复只恢复对应镜像配置并更新 hub-engine/nginx；等待活跃任务结束，健康检查、失败回退与暂停队列恢复必须在同一次受控操作内完成。不要删除数据或停止仍在正常运行的索引器。

本次原数据库快照与原镜像身份保存在 `local-data:I10/staging/radius-20260929/`。快照已在独立 PostgreSQL 16 恢复并执行增量迁移；这是本机回退验证，不代表异机灾备。

若撤回整个半径能力，才停止新增的索引器并恢复接入前的后端/前端镜像；仍保留原文、主题字段和私有索引。不要通过删除数据库/索引或清空 Docker volume 来回退。

## 验证

- `src/radius/*.test.ts`：输入边界、全文与转写、主题匹配、索引失败、只读密钥。
- `qa/radius/integration.mts`：专用 PG 与真实 Meilisearch，万篇合成数据，权限、历史全文、后补正文、新来源、失败恢复及真实路由。
- `qa/radius/browser.py`：隔离浏览器搜索、原文、主题新增/编辑/归档，1440px 与 390px。
- `qa/radius/mcp.py`：真实 stdio 握手、工具发现、搜索与正文读取，拒绝路径穿越且凭证不出现在输出。
- `qa/radius/ux-server.mts` + `ux-browser.py`：隔离库真实检索/任务存储、合成回答，验证侧栏、直接提问、引用阅读、正文字号、问本篇与桌面/手机布局。
- `qa/radius/question-api.py`：自动选材、幂等重试、冲突请求、来源范围、无资料和日期边界。
- `qa/radius/quality-browser.py`：双时段证据预览、发布时间未知、手动转写入口（HTTP 合成响应，不启动真实转写）和手机布局。
- 真实问答案例：`4fc90473-25e4-45ef-8251-4e873027dac8`，单例已完成。授权材料、完整稿件与核对、费用账本及真实登录页面证据在 `local-data:I10/staging/radius-20261002/evidence/`；不把这批私人验收痕迹纳入公开交付。
- 最终状态与正式库回读证据见 `docs/36-信息中枢V3可信可用收口任务跟踪.md`。

单次 API、合成数据和一次同步不代表所有渠道已经接入，也不代表已经完成长期稳定性观察。

## 工作流接入文字

n8n 或 OpenClaw 先完成获得内容、转文字和保留来源，再提供一个返回 JSON 的端点。示例见 `workflow-feed.example.json`；示例不会自动导入。公众号、抖音、即刻与 X 的平台登录或接口权限由已有工作流提供，信息中枢不绕过平台访问限制。

在现有信源管理添加自定义来源：`sourceType=custom`、`collectorType=custom`、`config.endpoint=<你的工作流 JSON 地址>`、`config.method=GET`。返回数组、`items` 数组或 `data` 数组均可；每条至少提供稳定 id、title、原文 url 和 content，有发布时间才填 publishedAt。音频/视频工作流已转好的文字可作为自定义文字来源收录，content 应保存原始转写并注明说话人与时间码。私有 endpoint/header 凭据留在本机配置，不写示例或共享说明。

完成接入后，先在信源管理采集一次，核对标题、内容和日期，再到信息半径搜索一个仅出现在正文中的词。之后按原采集频率更新，新内容和后来补齐的内容都进入同一索引。新增主题只需要关键词/同义词与可选来源范围，不需重建管道。

检索匹配量、抽样文章和来源分布不等于舆论统计。当前去重针对同一规范 URL 或完全相同的正文；跨来源同一事件仍需阅读后判断。时间对比明确排除发布时间未知的记录，并提示采集覆盖变化可能影响数量。
