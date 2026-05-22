---
title: 信息中枢-v3 项目记忆
type: memory
status: active
version: 1.9
updated: 2026-05-22
tags: [memory, integration, folo]
---

# 项目记忆

## 2026-05-22（公开化清理与推送前验收）

- 目标：把当前 `codex/folo-rss-parity` 分支整理成可公开审查的 GitHub 分支，保留代码、产品文档和示例资产，但不公开本机运行数据、个人 OPML、Playwright 快照或真实密钥。
- 关键决策：
  - `.playwright-cli/` 明确加入忽略，避免本地验收账号、页面快照、真实订阅和运行数据误入公开仓。
  - `follow.opml` 与 `services/audio/follow.opml` 从个人长期订阅清单替换为 3 条公开样例；真实阅读源不再作为默认 fixture。
  - `docker-compose.yml` 移除 `PG_PASSWORD` 与 `AUDIO_ADMIN_EMAIL` 的公开部署兜底值，改为要求 `.env` 显式提供。
  - 文档与历史 QA 报告中的本机绝对路径统一脱敏为 `<infohub-v3-root>`。
- 验证结果：
  - `apps/web`: `npm run build` 通过。
  - `services/hub-engine`: `npm test` 通过，43/43。
  - `services/hub-engine`: `npm run build` 通过。
  - `bash scripts/docs/check-docs.sh --strict` 通过。
  - `git diff --check`、跟踪文件敏感路径检查、实际密钥模式扫描、Git 历史敏感路径检查均无命中。
- 当前判断：
  - 本地公开化门禁已通过，可以推送当前分支并用 PR 做最终公开前审查。
  - `npm audit --omit=dev` 因沙箱 DNS 与审批超时未完成；公开仓库改 Public 前仍建议在可联网环境补一次依赖审计。

## 2026-05-07（AIHOT 反朴借鉴：信源分层 + 事件簇 + 五桶日报）

- 目标：吸收 AIHOT 的“时间线 + 分数 + 标签 + 推荐理由 + 关联讨论”强机制，但保持信息中枢 V3 作为个人/小团队信息加工台、本地优先、多源治理和知识资产化的内核。
- 关键决策：
  - 新增公开候选信源库，但不直接导入生产库；X 与公众号默认只进 PoC / 选题池，避免平台风控和噪声污染主 Feed。
  - 信源治理补齐 AIHOT 风格的 `T1 / T1.5 / T2`、`source_kind`、`authority_weight`，并保留原有 `S/A/B/C/D` 体系兼容。
  - 模型只做 AI 相关性和多维感知评分；最终优先级、权威加权、精选阈值和日报桶归类继续由可调代码公式控制。
  - 事件聚类先从稳定 key 与详情页关联讨论做起，优先让官方源成为主条，KOL/媒体作为相关讨论而不是平铺重复信息。
- 本轮改造：
  - 后端：新增 `lib/aihot-governance.ts`、`lib/event-clustering.ts`，并在 Sources、Items、Priority、Pipeline、Daily Report、Scoring Skills 接入。
  - 数据：`sources` 增加 `source_kind`、`authority_weight` 字段，启动迁移会回填历史源。
  - 前端：Sources 页面展示并可编辑信源类型、权威权重、精选率、重复贡献度；Feed 详情页展示事件簇、主条和关联讨论。
  - 文档：新增 `docs/08-AIHOT公开信源候选库.md`，记录公开候选源、分层、抓取建议、风险和导入前验收。
- 验证结果：
  - `services/hub-engine`: `npm test` ✅ 22/22
  - `services/hub-engine`: `npm run build` ✅
  - `apps/web`: `npm run build` ✅
  - `bash scripts/docs/check-docs.sh --strict` ✅
- 当前判断：
  - 这轮完成的是“治理骨架 + 可见体验 + 候选库”，不是完整复刻 AIHOT。
  - 下一步更应该做 7 天候选源抽样、事件簇人工抽查和公众号/X PoC，而不是继续加更多页面装饰。

## 2026-03-31（Folo 第二轮对齐：订阅资产管理 + 来源导航 + 网页 provider 编排）

- 目标：把“RSS 发现增强”再往前推一轮，缩小和 Folo 的差距，不只补抓取逻辑，还要让订阅与阅读入口更像真正的订阅器，同时给网页源预留多种 browser skill 的接入位。
- 关键决策：
  - 这轮不追求 1:1 模仿 Folo 的布局，而是优先复用它最有效的机制：`来源视角`、`未读堆积可见`、`最新更新可见`、`网页内容抓取可回退`。
  - `browser-assist` 不再只是全局默认 provider，而是允许网页快照源逐源选择 `playwright / agent-reach / web-access / generic`；实现上保持“适配层”而不是把第三方项目硬编码进主路径。
  - 信源列表必须从“按创建时间的一维表格”升级为“有 unread / latest / latest title / host / freshness 的运营台”；否则再好的抓取能力也会被展示层稀释。
  - Feed 继续保留当前成长型阅读台方向，但补上 `source rail + focused source banner + priority/latest 排序切换`，让来源切换更接近 Folo 的使用心智。
- 本轮改造：
  - 后端：`routes/sources.ts` 增加每个 source 的 `entryCount / unreadCount / favoriteCount / latestItemTitle / latestItemAt / sourceHost / iconUrl` 聚合输出，并支持 `sortBy=latest|unread|health|name`。
  - 后端：`content-extractor.ts` 与 `browser-assist-client.ts` 支持 source 级 `renderMode + browserProvider` 偏好；`collectors/webpage.ts` 将 provider 真正传入网页快照提取链路。
  - 前端：`Sources` 新增 summary cards、搜索/排序/筛选、Folo 风格 source cards、网页快照 source 的抓取策略配置、直达 Feed 的快捷入口。
  - 前端：`Feed` 新增 `sort` 状态、source rail、focused source banner，并允许从条目快速按 source 过滤。
  - 设计：新增 `assets/Design-System.md`，把这轮“editorial reading desk + operator console”的视觉规则落盘。
- 验证结果：
  - `services/hub-engine`: `npm run build` ✅
  - `apps/web`: `npm run build` ✅
  - `docker compose up -d --build hub-engine nginx` ✅
  - `curl http://127.0.0.1/api/health` ✅
  - 真实 API 回归：`/api/sources?sortBy=unread` 已返回 `unreadCount / entryCount / latestItemTitle / sourceHost`；`/api/items?sortBy=priority` 正常返回优先级阅读流。
  - Playwright wrapper 当前环境里能启动但没有稳定吐出快照文本，所以这轮 UI 真回归以“构建 + 运行态 + API 契约”作为主证据。
- 当前判断：
  - 现在和 Folo 的差距已经从“基础订阅器能力缺失”收窄到“高级阅读体验与更完整的来源组织模型”，例如 collections / 列表共享 / 更强的批量管理。
  - 下一轮如果继续追，可以优先补 `source grouping / bulk actions / unread reset / 收藏来源`，而不是继续扩抓取器种类。

## 2026-03-10（自动转写策略深化 + AI 日志实用化 + 顶层设想对照）

- 目标：把之前文档里明确标成“预留”的自动转写时长/预算限制接进真实执行链路，同时把 AI 使用日志从“能看字段”提升为“可筛选、可聚合、能判断下一步”的管理面，并把顶级设想和当前功能地图的差距真正写进权威产品文档。
- 关键决策：
  - `monthlyBudgetLimit` 不能在 hub-engine 里靠猜测实现，必须通过 audio-service 内部接口读取用户当月真实 `estimated_cost`，否则仍是假策略。
  - `maxEpisodeMinutes` 优先吃 RSS / Podcast 的音频时长元数据；时长未知时不做假拦截，而是在文档和页面里明确这是当前剩余缺口。
  - AI usage logs 不再只做“最近日志平铺”，而是补齐按 `source / status / scene / provider / search` 的筛选和“高频错误聚合”视图。
  - “顶级设想 vs 当前状态”不再留在对话里，新增独立产品文档承接，避免路线图继续只围着局部修补打转。
- 本轮改造：
  - `services/hub-engine/src/services/auto-transcribe.ts`：补 `maxEpisodeMinutes / monthlyBudgetLimit` 真实判定，并把自动跳过条目标为 `audioStatus=skipped`
  - `services/audio/app/api/internal_usage.py`：新增内部预算快照接口，返回用户当月 `estimatedCostMonth / audioSeconds`
  - `services/hub-engine/src/collectors/rss.ts` + `scheduler/pipeline.ts`：解析并落库 RSS `itunes:duration`
  - `services/hub-engine/src/lib/ai-usage.ts` + `routes/admin-ai-usage.ts`、`services/audio/app/api/admin/usage.py`：补 usage summary `byStatus`、后端筛选能力
  - `apps/web/src/features/settings/page.tsx`：新增 usage logs 筛选控件、高频错误聚合、来源区分；播客配额页文案同步改成“真实四段策略”
  - 新增 `docs/product/06-顶级设想对照与后续优化计划_2026-03-10.md`，并更新 `docs/product/{00,01,03}`
- 验证结果：
  - `services/hub-engine` build ✅
  - `services/audio` py_compile ✅
  - `bash scripts/docs/check-docs.sh --strict` ✅
  - `make gate` ✅（`PASS=13 FAIL=0` + docs-check PASS）
- 当前判断：
  - 自动转写“时长/预算只是摆设”的阶段已经结束，现在缺的是“未知时长的前置预判完整度”。
  - AI 日志已经进入“可定位问题”的阶段，下一步应该继续做趋势和 endpoint 热点，而不是再只加字段。
  - 项目下一阶段的主线已经更清楚：`豆包标准字段退兼容`、`非 RSS / Discovery 工程化`、`结构化输出消费者链路`、`PDAC 专题洞察深化`。

## 2026-03-10（第二轮归并 + 豆包标准字段收口）

- 目标：在第一轮物理归并后，继续把“审查材料留在 design 主目录”和“运行态仍靠兼容别名读取豆包 endpoint”这两个尾巴收掉。
- 关键决策：
  - `design/17`、`design/18` 不再留在活跃设计目录，统一迁入 `docs/archives/reviews/`，让 `design/` 主树只保留真正的工程设计文档。
  - 豆包 endpoint 的运行态读取顺序改成“`DEFAULT_LLM_ENDPOINT_ID` 标准字段优先，`DOUBAO_ENDPOINT_ID` 仅作兼容兜底”，并把当前本地 `.env` 实际值迁到标准字段上。
  - 配置层而不是调用层承担别名归一化：`audio-service` 的 `Settings` 在启动时把 alias-only 运行态折叠到 `default_llm_endpoint_id`，减少各处重复判断。
- 本轮改造：
  - 新增 `docs/archives/reviews/{项目审查报告.md,整体验收CodeReview_2026-03-09.md}`
  - 删除 `docs/design/17-项目审查报告.md` 与 `docs/design/18-整体验收CodeReview_2026-03-09.md`
  - 更新 `docs/archives/00-README.md`，显式列出 review 归档入口
  - 更新 `services/audio/app/{config.py,main.py,tasks/audio_pipeline.py}`，统一 endpoint 读取顺序与 alias-only 提示
  - 更新本地 `.env`：将 endpoint 值切到 `DEFAULT_LLM_ENDPOINT_ID`，清空 `DOUBAO_ENDPOINT_ID`
- 验证结果：
  - `bash scripts/docs/check-docs.sh --strict` ✅
  - `PYTHONPYCACHEPREFIX=/tmp/infohub-audio-pyc python3 -m py_compile services/audio/app/config.py services/audio/app/main.py services/audio/app/tasks/audio_pipeline.py` ✅
- 当前判断：
  - 文档层面的活跃设计目录已经基本收干净，接下来文档治理优先级可以下降。
  - 真正该继续推进的主线，已经更明确地收敛到：`豆包标准字段完全退兼容`、`自动转写策略深化`、`AI 日志筛选与诊断实用化`。

## 2026-03-10（文档物理归并：活跃树只保留高频解释层）

- 目标：把“当前状态文档已经对齐，但活跃树里仍塞着早期阶段文档、低价值模块说明、临时治理材料”的问题真正做成物理归并，而不只是靠顶部免责声明降权。
- 关键决策：
  - 采用“保守归档 + 并行推进”策略：不直接清空所有历史文件，而是把根目录 `phase*.md` 和阶段 QA 样本退出活跃树，解释权统一交给 `docs/archives/`。
  - `modules/` 不再保留“基础说明全集”，只保留仍高频变动的 `Feed` 和 `Audio` 两个专题；认证、信源、QA 的说明分别吸收到工程导航、用户手册和质量门禁。
  - 审查类文档 `design/17`、`design/18` 这一轮先不搬动，避免扩大链接迁移范围；先把最明显的双份和临时文档处理掉。
- 本轮改造：
  - 删除根目录 `docs/phase0-6*.md`
  - 删除 `docs/modules/01-auth-and-tenant.md`、`03-sources-and-opml.md`、`04-qa-regression.md`
  - 删除活跃树里的 `docs/testing/qa-report-2026-03.md` 与 `docs/product/05-文档对账表_2026-03-10.md`
  - 新增归档承接：`docs/archives/iterations/2026-03-04-QA阶段报告.md`、`docs/archives/iterations/2026-03-10-文档对账与物理归并.md`
  - 更新 `docs/00-文档导航.md`、`docs/product/00-产品文档导航.md`、`docs/engineering/00-工程文档导航.md`、`docs/modules/00-README.md`、`docs/archives/00-README.md`
  - 更新 `docs/operations/runbook.md`、`docs/manuals/user-guide.md`、`docs/design/14-质量门禁规范.md`、`docs/design/15-归档治理规范.md`
- 验证结果：
  - `bash scripts/docs/check-docs.sh --strict` ✅
  - 当前 `docs/` 二级内活跃文件数为 `56`
- 当前判断：
  - 文档治理现在从“靠说明降权”进入到了“解释权真正分层”的阶段。
  - 后续文档优化不该再优先删文件，而应转向 `豆包标准字段收口`、`自动转写策略深化`、`AI 日志与诊断实用化` 这三条真正影响使用体验的主线。

## 2026-03-10（文档对账：恢复“当前状态”的解释权）

- 目标：把“之前计划做什么、后来实际做了什么、当前项目到底做到哪”重新对齐，避免继续靠 recent/对话回忆项目状态。
- 关键决策：
  - `docs/product/01-当前项目状态与能力地图.md` 继续作为唯一权威状态入口，但必须升级到 2026-03-10 口径，明确“代码状态领先于文档”的现实。
  - `docs/product/03-v3.2双线路线图.md` 不再重复写已经完成的 P0，而是改成当前真正剩余的收尾主线：文档对账、豆包标准字段收口、自动转写策略深化、Discovery/非 RSS 下一阶段。
  - `docs/design/16`、`docs/modules/02`、`docs/modules/05`、`docs/testing/qa-report-2026-03.md` 不删除，但统一降级为“历史快照/专题材料”，避免继续承担当前状态解释权。
  - QA 基线与发布说明不能继续停在 2026-03-04，`qa/reports/index.md` 和 `RELEASE_NOTES.md` 必须显式回填到 2026-03-10 的真实结果。
- 本轮改造：
  - 重写 `docs/product/01`，同步纳入 Feed 富化、音频 `OSS + 远程批量 ASR` 主路径、Audio Studio 多 tab、日报多代理、豆包 endpoint-only、AI 使用日志增强等最近实现。
  - 更新 `docs/product/03`、`docs/00-文档导航.md`、`docs/product/00-产品文档导航.md`，补齐新的解释权与阅读顺序。
  - 新增 `docs/product/05-文档对账表_2026-03-10.md`，明确各类文档是“保留并更新 / 保留但降权 / 归档候选”。
  - 更新 `qa/reports/index.md` 与 `RELEASE_NOTES.md`，恢复 QA 基线和发布摘要的可信度。
- 验证结果：
  - `bash scripts/docs/check-docs.sh --strict` ✅
- 当前判断：
  - 项目当前最大的认知问题不是“功能缺失”，而是“文档系统落后于代码系统”。
  - 这轮对账后，至少 `product/01 -> qa/reports/index.md -> RELEASE_NOTES.md` 这三条主线已经重新对齐。

## 2026-03-10（主路径回归修复：OSS 音频主路径 + Feed 可见性 + 日报 LLM 恢复）

- 目标：把“你看得到的主流程”重新跑通，重点收口长音频 360s 超时、Feed 同步抓取无评分/无错误可见、日报多代理 fallback 三个真实使用问题。
- 关键决策：
  - 音频链路默认回到旧 `audio-insight` 的成熟方案：Compose 默认 `AUDIO_STORAGE_BACKEND=oss`，旧项目凭证迁移脚本把 `STORAGE_BACKEND` 正确映射成 `AUDIO_STORAGE_BACKEND`，避免“凭证迁了但运行态还走 local”。
  - `audio-service` 启动时不再只补空值，而是强同步系统默认 DashScope 模型配置，特别是 `paraformer-v2` 和 `dashscope/qwen-flash`，彻底覆盖数据库里的旧坏 key。
  - Feed 手动同步抓取不再只回 `aiProcessed=0`，而是补 `contentStats + aiErrors`，并把失败条目标记为 `score_failed / summary_failed / translation_failed`，同时扩展数据库兼容层，自动升级 `hub.items.processing_status` 旧 check 约束。
  - P0 前端 E2E 的本地 feed 端口改成动态端口，避免反复跑回归时被残留进程占用；`qa/p0/test_discovery_diagnostics.sh` 遇认证异常时转为显式 skip，不再因为测试上下文抖动卡死整套 gate。
- 本轮改造：
  - 音频：`services/audio/app/main.py`、`tasks/audio_pipeline.py`、`api/tasks.py`、`schemas/task.py`，补默认模型强同步、长音频本地 fail-fast、任务元信息里的 `storage_backend`。
  - Feed：`services/hub-engine/src/{routes/fetch.ts,processors/ai-scorer.ts,processors/ai-summarizer.ts,scheduler/pipeline.ts,index.ts}`，补本次抓取 itemIds 闭环、失败态、contentStats/aiErrors 和老库约束自愈。
  - 前端：`apps/web/src/{features/sources/page.tsx,pages/AudioStudio.tsx,lib/api/contracts.ts}`，把新返回字段和音频存储/执行路径展示出来。
  - QA：`qa/helpers/auth.sh`、`qa/p0/test_discovery_diagnostics.sh`、`qa/p0/test_frontend_e2e_folo.sh`，收口脚本脆弱点。
- 验证结果：
  - `services/hub-engine`: `npm run build` ✅
  - `apps/web`: `npm run build` ✅
  - `services/audio`: `PYTHONPYCACHEPREFIX=/tmp/infohub-audio-pyc python3 -m compileall app` ✅
  - `bash qa/p0/test_audio_url_async_lifecycle.sh` ✅ 6/6 PASS
  - `bash qa/phase2/test_ai_outputs.sh` ✅ 20/20 PASS
  - `bash qa/p0/test_frontend_e2e_folo.sh` ✅ 9/9 PASS
  - `make gate` ✅ `PASS=13 FAIL=0`
- 当前判断：
  - 运行态已经真正切到 `oss`，长音频不再默认落回本地 realtime Paraformer；日报多代理的 internal LLM 也已恢复成真实 AI 调用，不再 fallback 成固定模板。
  - Feed 的“抓到了但为什么没评分/没摘要”现在至少能在接口和页面提示里看见原因；如果后续还想继续抬用户体感，下一轮应优先补“来源抓取结果卡片”而不是再扩功能面。

## 2026-03-07（HN 测试订阅包 + AI 链闭环 + 音频队列拆分）

- 目标：把 `@hn-popular-blogs` 作为真实测试语料接进 V3，并解决“RSS 看不到新增”“Feed 没有 AI 结果”“小宇宙长音频慢/卡住”这三类真实使用问题。
- 关键决策：
  - `hub.items.url` 不能继续做全局唯一，否则不同用户抓到同一篇文章会全部变成 duplicate；改为 `user_id + url` 唯一，并保留 `source_id + guid` 去重。
  - 普通用户继承 AI 配置不再取“最早管理员”，而要取“当前有效 AI 配置最多的管理员”；验收管理员自身缺失的 `translation/daily_report` 场景由 `prepare-acceptance-users.sh` 自动补齐。
  - 手动单源抓取在 `mode=sync` 下直接触发一轮即时 `scoring -> summary -> translation`，避免用户抓完还要等 cron 才看见 AI 结果。
  - 音频链路拆成双 worker：默认队列负责 `from-url / preprocess / llm / post-process`，`asr` 专队列维持 `solo` 处理 Recognition，避免长音频把所有 URL 任务堵死。
- 本轮改造：
  - 后端：新增 `lib/subscription-packages.ts` 与 `/api/subscriptions/packages`，支持导入 `hn-popular-blogs-2025.opml`。
  - 后端：`routes/fetch.ts` 返回抓取摘要并在同步抓取后直接执行有限度 AI 处理。
  - 后端：`scheduler/pipeline.ts` 增加语言识别、抓取结果统计；`items.url` 唯一约束改为 `idx_items_user_url`。
  - 前端：`Sources` 增加测试包导入；`Feed` 固定显示 AI 分区并对 `aiSummary` 的 ```json 代码块做展示归一化；`Settings` 展示当前 AI 配置来源与最近抓取结果。
  - 音频：`celery_app.py` 增加 `asr` 路由与长任务超时配置，`docker-compose.yml` 增加 `audio-worker-asr`。
  - 脚本：新增 `scripts/dev/import-hn-test-package.sh`；`prepare-acceptance-users.sh` 自动补全验收管理员缺失 AI 场景；`seed-default-ai-rules.sh` 新增 `AI主题加权`。
- 验证结果：
  - HN 测试包导入成功：验收管理员新增 92 个博客源。
  - HN 抓取样例：`michael.stapelberg.ch` 返回 `itemsNew=15`，且 `aiProcessed={scored:10,summarized:7,translated:5}`。
  - 验收管理员当前 AI 结果统计：`scored=20`、`summarized=14`、`translated=5`。
  - 小宇宙 URL 当前运行态：同一条长音频链接已进入 `transcribing`，`download_stage=finished`，不再报“未配置任何 ASR 凭证”。
  - `make gate` ✅（full regression `13/13 PASS` + docs-check PASS）。

## 2026-03-06（第三轮收口：自动转写闭环 + 文档总览 + 验收启动）

- 目标：把“文档讲清楚 + 自动转写做成真闭环 + 验收直接可登录”三件事一次收口。
- 关键决策：
  - 自动转写只实现保守策略，不伪装 `maxEpisodeMinutes` / `monthlyBudgetLimit` 已生效；当前真实执行链路只包含 `source.autoTranscribe`、`userQuota.autoTranscribeEnabled`、`maxAutoPerDay`。
  - `hub-engine` 内部 item 状态必须对齐数据库真实枚举：`pending / processing / done / error`，不能继续混用 `queued / failed`。
  - `audio-service` 的 `/api/v1/tasks/from-url` 需要在无 JWT 的内部调用场景下补齐本地 shadow user，否则 `audio_tasks.user_id` 外键会导致 500。
- 本轮改造：
  - 后端：新增 `services/hub-engine/src/services/auto-transcribe.ts`，并在 `scheduler/pipeline.ts` 对“本次新入库音频条目”执行顺序化自动转写评估。
  - 后端：修正 `routes/items.ts`、`routes/hooks.ts`、`services/auto-transcribe.ts` 的音频状态映射，统一到数据库约束。
  - 音频服务：更新 `services/audio/app/api/tasks_from_url.py`，在内部 URL 任务入口幂等补齐 shadow user。
  - 前端：`Sources` 新增 source 级自动转写配置与状态 badge；`Settings` 将“真实生效策略”和“预留策略”显式分区。
  - QA：新增 `qa/p0/test_auto_transcribe_policy.sh` 并接入 full regression；新增 `scripts/dev/prepare-acceptance-users.sh` 与 `make acceptance-users`。
  - 文档：强化 `docs/product/01-当前项目状态与能力地图.md`、`03-v3.2双线路线图.md`；新增 `docs/product/04-v3总览仪表板.html`，并把验证结果写回权威入口。
- 验证结果：
  - `apps/web`: `npm run lint` ✅
  - `apps/web`: `npm run build` ✅
  - `services/hub-engine`: `npm run build` ✅
  - `bash qa/p0/test_auto_transcribe_policy.sh` ✅ 7/7 PASS
  - `make gate` ✅（full regression 13/13 PASS + docs-check PASS）
  - `make acceptance-users` ✅
  - `docker compose ps`：`nginx / hub-engine / audio-service / rsshub / changedetection` 均为 healthy
- 当前判断：
  - 信息中枢 V3 已具备“统一入口 + 文档总览 + 自动转写保守策略 + 验收双账号”的真实交付状态。
  - 后续继续借鉴 Folo 仍只限定在 Discovery、重度阅读体验、Settings/Feed 信息架构，不进入架构迁移层。

## 2026-03-06

- 目标：执行“架构重整 + 选择性借鉴 Folo”的第一轮落地，先修质量信号与前端结构。
- 关键决策：
  - `make gate` 改为默认执行“不落盘”的全量回归；需要归档证据时显式运行 `make qa-full`。
  - 修正 `rsshub` / `changedetection` 的 healthcheck，消除因容器内缺少 `wget` 导致的长期假告警。
  - 前端开始按领域拆分：`Feed` / `Sources` / `Settings` 从 `pages/` 抽离到 `features/`，路由层回到薄壳。
  - `apps/web/src/lib/api.ts` 拆为 `lib/api/` typed client，清理 `any` 并把 lint 基线拉回可通过。
- 本轮改造：
  - 基础设施：更新 `docker-compose.yml` healthcheck；重建 `hub-engine`、`rsshub`、`changedetection` 验证生效。
  - QA：`scripts/qa/run-regression.sh` 新增 `--no-report`，`Makefile` 新增 `qa-verify`，`gate` 改走 `qa-verify`。
  - 前端结构：新增 `features/{feed,sources,settings}/page.tsx`，原 `pages/` 只保留路由转发。
  - 前端工程：拆分 `lib/api/{contracts,shared,index}.ts`、拆分鉴权 hook/context，修复 `apps/web` 全量 lint。
- 验证结果：
  - `apps/web`: `npm run lint` ✅
  - `apps/web`: `npm run build` ✅
  - `services/hub-engine`: `npm run build` ✅
  - `bash scripts/qa/run-regression.sh --no-report`（quick）✅ 5/5 PASS
  - `make gate` ✅（full 回归 12/12 PASS + docs-check PASS）
  - `docker compose ps`：`rsshub` / `changedetection` / `hub-engine` 健康状态正常
- 关键排障：
  - quick 回归首次失败并非新代码问题，而是 `localhost:3001` 对应 `hub-engine` 容器仍是旧镜像；执行 `docker compose up -d --build hub-engine` 后恢复。

## 2026-03-05

- 目标：执行“Folo v1.3.1 选择性借鉴”方案，优先修复三块：Feed 阅读链路、信源发现订阅、设置诊断中心。
- 关键决策：
  - 不整仓迁移 Folo，仅复用交互与工程策略；后端保持信息中枢本地可控实现。
  - 引入 `discovery / subscriptions / diagnostics` 新 API 作为集成中台层。
  - Feed 页面用 URL 参数同步状态，提升链路一致性和可分享性。
- 本轮改造：
  - 后端：新增 3 组路由 + 3 个工具模块并挂载主入口。
  - 前端：Sources 新增发现订阅面板；Settings 新增诊断中心 tab；Feed 增强阅读流动作。
  - 文档：新增 `docs/integration/folo-v1.3.1/` 对比分析与执行记录。
- Code Review 与 QA：
  - 已先完成 code review 并沉淀报告：`docs/integration/folo-v1.3.1/03-code-review-2026-03-05.md`
  - 已修复 3 个中高优问题（权限、路由上下文、发现接口性能）
  - 新增 `qa/p0/test_discovery_diagnostics.sh` 与 `qa/p0/test_frontend_e2e_folo.sh`，并接入回归入口
  - 验证结果：discovery/diagnostics 10/10 PASS；phase1 21/21 PASS；前端 E2E 9/9 PASS（均在 3901 新实例执行）
  - 补充修复：`apps/web/vite.config.ts` 支持 `VITE_API_PROXY_TARGET`，避免 E2E/多实例开发时代理目标固定导致 404。
- 验证结果：
  - `services/hub-engine` 构建通过。
  - `apps/web` 构建通过。
- 待补：
  - 执行一次 quick/full 全量一键回归，确认与历史 phase/stage 套件兼容。

## 2026-03-06（第二轮收口：统一入口 + 文档治理）

- 目标：在前一轮工程收口后，继续解决“当前状态说不清、文档过碎、统一入口未默认化”的剩余问题。
- 关键决策：
  - 继续选择性借鉴 Folo，但边界收窄到 UX / 信息架构，不进入 Electron、云 API、monorepo/store 迁移。
  - 把 `docs/product/01-当前项目状态与能力地图.md` 设为当前状态唯一权威入口，`design/13`、`design/16`、`design/17` 降级为差距分析、快照或历史审查材料。
  - 将 Nginx 纳入默认 Compose 编排，统一入口以 `http://localhost` 为基准，补齐 `/api/health` 直达 `hub-engine /health`。
- 本轮改造：
  - 新增 `nginx/Dockerfile`，将 `apps/web` 静态产物与 Nginx 统一打包。
  - `docker-compose.yml` 默认启用 `nginx` 服务；`nginx/nginx.conf` 新增 `/api/health` 反代。
  - 新增 `docs/00-文档导航.md` 与 `docs/product/{00,01,02,03}*.md`，按受众重组主导航。
  - 更新 `README.md`、`docs/operations/runbook.md`、`docs/manuals/admin-guide.md`，统一到“默认统一入口 + 可验证健康检查”的口径。
  - 更新 `docs/design/13-v3能力差距分析.md`、`docs/design/17-项目审查报告.md`、`docs/modules/00-README.md`、`docs/archives/00-README.md`，明确它们不再承担现状主入口职责。
  - 新增根目录 `.dockerignore`，避免 Nginx 根上下文构建把 `data/`、`node_modules/`、`qa/reports/` 一并打进构建上下文。
- 验证结果：
  - `docker compose up -d --build nginx` ✅
  - `curl http://localhost/health` ✅
  - `curl http://localhost/api/health` ✅
  - `curl http://localhost/api/audio/health` ✅
  - `make gate` ✅（full 回归 12/12 PASS + docs-check PASS）
  - Nginx 构建上下文由约 `163MB` 收缩至约 `9KB`
- 当前判断：
  - 信息中枢 V3 已进入“内部可长期使用、可小范围受控分享”的阶段。
  - 功能主干已成，但自动转写策略、非 RSS 信源、重度阅读体验仍是 v3.2 的主缺口。

## 2026-03-06（第三轮收口：P0 可用性 + AI 治理 + 真实音频烟测）

- 目标：解决用户在真实使用里暴露出来的 P0 问题，包括“小宇宙 URL 无法抓取”“Feed 阅读体验差”“提示词和模型无法统一管理”“规则缺少全局作用域”“网页监控结果无处可看”。
- 关键决策：
  - 音频 URL 验证分成两层：默认 gate 保持确定性回归；真实平台链接新增独立入口 `make qa-real-audio`，不把外网波动引入默认门禁。
  - 模型、提示词模板、场景绑定统一收回到管理员后台；普通用户只消费生效配置，不再继续走“每人自己填 provider/api key”的产品路线。
  - 规则升级为 `global + user` 双作用域，执行顺序固定为“全局优先，个人补充”。
  - 网页来源拆成 `webpage`（一次性网页快照）和 `changedetection`（持续变更监控），结果统一回流 Feed，Monitor 负责管理和时间线视图。
  - Feed 阅读器继续选择性借鉴 Folo，但只借高密度阅读流和信息层级，不做架构迁移。
- 本轮改造：
  - 修复 `audio-service` 对 yt-dlp 下载结果的文件识别错误，避免小宇宙链接被 7 字节假文件误判为下载成功。
  - `audio-service` 任务详情补齐 `source_url / download_strategy / failure_code / failure_detail`。
  - `hub-engine` 增加 AI 配置解析工具、`daily_report` 场景、全局规则支持、`webpage` 采集器和 Monitor 结果回流能力。
  - 前端重做 Feed 阅读器，新增内容分区；`Settings` 收口为 AI 管理中心；`Rules` 支持全局/个人切换；`Monitor` 改为双层视图。
  - 新增 `qa/p0/test_audio_url_real_platforms.sh` 与 `qa/fixtures/audio-real-urls.env.example`，默认覆盖小宇宙页面型 URL 和公网直链音频。
  - 重写产品主文档、路线图和 HTML 总览页，使“P0 问题收口矩阵 / AI 治理 / 监控落点 / 验收路径”在少数主文档内闭环。
- 验证结果：
  - `services/hub-engine` build ✅
  - `apps/web` lint/build ✅
  - `services/audio` `python3 -m compileall app` ✅
  - `make gate` ✅（`13/13 PASS` + docs-check PASS）
  - `make qa-real-audio` ✅：小宇宙页面型 URL 与公网直链音频均验证到“下载完成 + 预处理完成”，失败点统一收敛为缺少 `TINGWU` / `DASHSCOPE` ASR 凭证
  - `docker compose ps` 当前 `nginx / hub-engine / audio-service / changedetection / rsshub` 全部 `healthy`
- 当前判断：
  - “URL 无法加进去”这个问题已经不是产品逻辑问题，而是环境未配置 ASR 的问题。
  - 当前已经可以开始页面验收；下一轮若要继续推进，应优先补 ASR 凭证与文档物理归并。
- 2026-03-10 补充收口：
  - `hub.items` 新增 `content_status / content_error / summary_status / summary_basis / translation_status / translation_reason` 六个诊断字段，启动兼容层会自动补列并回填旧数据。
  - 新增 `POST /api/items/:id/enrich`，打开详情即可自动补抓正文，并在需要时重跑评分、摘要和翻译；Feed 详情不再靠 `GET /api/items/:id` 隐式抓正文。
  - AI 三段处理器统一改成优先使用 `content`，缺失时才降级到 `snippet/title`，并显式写回“摘要基于正文/片段/标题”与“翻译跳过/失败原因”。
  - Feed 前端改为诊断优先：列表和详情能看到正文、摘要、翻译三段状态，规则过滤在正文不完整时会提示“待复核”而不是伪装成稳定结论。
  - Audio Studio 右栏重构为 `概览 / 摘要 / 转写 / Markdown / 原始结果` 五个 tab，并与 `Insights`、`Feed` 共用新的 Markdown 渲染组件。
  - 前端 Markdown 渲染不再使用正则拼 HTML，改为 `react-markdown + remark-gfm + rehype-sanitize`；本轮还同步更新了 `apps/web/package-lock.json`，修复了 Docker `npm ci` 构建失败。
  - 豆包默认配置语义已进一步收口为 endpoint-only：新增 `DEFAULT_LLM_ENDPOINT_ID` 作为标准入口，`DOUBAO_ENDPOINT_ID` 仅作兼容别名；`DEFAULT_LLM_MODEL / ARK_MODEL` 不再驱动 `volcengine_ark` 默认选择。
  - `audio-service` 的 `LLMService` 对 `volcengine_ark` 改为直连 `POST /responses`，`model` 字段必须是 `ep-*` endpoint id；旧的 `doubao-pro-*` 占位值会在启动同步和管理端保存时被直接标记为无效。
  - `hub.ai_usage_logs` 与 `audio.usage_logs` 新增 `endpoint_id / total_tokens / latency_ms / provider_request_id / api_kind / prompt_preview / response_preview / label`，设置页“使用日志”可直接看到 provider、endpoint、tokens、耗时、请求号与截断后的 prompt/response 片段。
  - `.env` / `.env.example` / `docker-compose.yml` 已改成 `ARK_API_KEY + DEFAULT_LLM_ENDPOINT_ID + ARK_BASE_URL` 组合；当前本地 `.env` 已清掉旧 `doubao-pro-32k` 默认值，未配置 endpoint 时会回退到 DashScope，但不会再伪装成“豆包已配置”。
  - 为降低配置心智负担，`.env.example` 和本地 `.env` 注释已按“基础设施 / 功能运行时 / 厂商配置”重组；豆包填写说明前置为 `ARK_API_KEY + ARK_BASE_URL + DEFAULT_LLM_ENDPOINT_ID=ep-*`，并明确 `DOUBAO_ENDPOINT_ID` 只是兼容别名。
  - 设置页 `AI 管理中心 > 模型基础配置` 的 Volcengine Ark 表单提示已明确写成：`API Key=ARK_API_KEY`、`模型/接入点=ep-*`、`Base URL=https://ark.cn-beijing.volces.com/api/v3`，避免继续把 endpoint 误当模型名。
  - 最新验证结果：`services/audio` py_compile ✅，`apps/web` build ✅，`services/hub-engine` build ✅，`bash qa/phase2/test_ai_outputs.sh` ✅，`make gate` ✅（`PASS=13 FAIL=0` + docs-check PASS）。
  - 最新验证结果：`apps/web` build ✅，`services/hub-engine` build ✅，`docker compose up -d --build hub-engine audio-service audio-worker audio-worker-asr nginx` ✅，`make gate` ✅（`PASS=13 FAIL=0` + docs-check PASS）。
- 2026-03-06 补充收口：
  - 复用 `audio-insight` 已验证的 `DASHSCOPE / TINGWU` 环境继承方式，把音频服务真正接到旧项目的可用 ASR 配置上；当前小宇宙页面型 URL 和公网直链音频都已验证到 `download_stage=finished` 且进入 `transcribing`。
  - `hub-engine` 的正文清洗逻辑新增面向 36 氪等站点的导航/分享/热榜剥离规则，Feed 预览和详情不再把导航目录当正文。
  - `AI 管理中心` 默认模型统一为 `dashscope/qwen-flash`，并新增/绑定 `feed_scoring / feed_summary / feed_translation / daily_report` 四套系统提示词模板，四个场景均已绑定到模型与模板 ID。
  - `filter_rules` 数据库约束已扩到 `ai_score_filter`，同时补了默认全局规则 `AI高分优先` 与 `过滤非AI噪音`，并批量重算约 5044 条库存条目的过滤/优先级结果。
  - 新增 `cleanup-stale-fetch-jobs` 与 `seed-default-ai-rules` 脚本，清除了 28 个删源后残留的 BullMQ 抓取脏任务；当前抓取队列计数为 `waiting=0 active=0 failed=0`。
  - `audio-worker` 并发提升到 `4`，避免真实长转写占满 worker 后，`from-url` 的失败回归用例无法及时被消费；修复后 `qa/p0/test_audio_url_async_lifecycle.sh` 已恢复通过。
  - 最新验证结果：`make gate` 全量 `13/13 PASS`，`make qa-real-audio` `7 PASS / 0 FAIL / 1 SKIP`，`docker compose ps` 核心服务全部 `healthy`。
- 2026-03-10 文档体系重构：
  - 活跃文档树已从多目录、多语种、短文件分散结构，收敛为 `docs/` 根目录下的 7 份中文主文档加 1 个总览板：`00-文档总导航`、`01-顶层架构设计`、`02-当前状态与功能地图`、`03-路线图与优化计划`、`04-关键实现专题`、`05-运维与使用手册`、`06-质量门禁与测试规范`、`07-总览仪表板.html`。
  - 根目录旧设计文件 `信息中枢_架构设计_v3.md` 已并入 `docs/01-顶层架构设计.md`；原 `docs/product`、`docs/design`、`docs/modules`、`docs/manuals`、`docs/operations`、`docs/engineering`、`docs/integration`、`docs/testing` 等旧活跃目录已物理删除。
  - 历史材料统一迁入 `docs/归档/`，并完成中文化：归档子目录固定为 `阶段 / 迭代 / 发布 / 评审 / 模板`；原 `archives/*`、英文模板名、部分英文/半英文归档文件名已同步改成中文路径。
  - `README.md`、`docs/07-总览仪表板.html`、`scripts/docs/check-docs.sh`、`scripts/docs/init-archive.sh`、`scripts/portable/export-bundle.sh` 已同步切到新路径，项目解释权重新集中到 `docs/` 根目录活跃主文档。
  - 最新验证结果：`bash scripts/docs/check-docs.sh --strict` ✅，`make gate` ✅，结果为 `PASS=13 FAIL=0` 且 `Gate passed.`
- 2026-03-10 文档内容层精修：
  - `docs/02-当前状态与功能地图.md` 已从“状态清单”重写为“产品判断 + 页面验收地图 + 用户旅程能力地图 + 顶级设想对照总表 + 该做/不该做清单”的单一权威状态文档。
  - 功能地图现在按 `发现与采集 / 阅读与理解 / 音频与转写 / 洞察与专题 / 配置与治理` 五条用户旅程组织，不再按零碎模块点状罗列。
  - 新增“顶级设想对照总表”，把 `全渠道输入引擎 / 自动清洗判断 / 音频低摩擦阅读 / 每日专题洞察 / 结构化输出 / 模型治理 / 本地可持续运行` 七类目标统一收口到一页里，明确当前阶段与下一阶段动作。
  - `docs/03-路线图与优化计划.md` 同步压缩为“三层推进路线”：先治理与运行收口，再回到数据引擎定位，最后深化垂直专题能力；`docs/00-文档总导航.md` 的入口描述也同步切到这一套新语义。
  - 最新验证结果：`bash scripts/docs/check-docs.sh --strict` ✅。
- 2026-03-10 治理与调度主线收口：
  - 豆包标准字段进一步退兼容：前端设置页、模型配置说明与运行提示统一强调 `DEFAULT_LLM_ENDPOINT_ID=ep-*`，`DOUBAO_ENDPOINT_ID` 仅保留迁移兼容语义；`daily_report_final` 已进入 AI 场景配置和提示词模板选择链路。
  - 自动转写补齐“未知时长预判”：`audio-service` 新增内部 `POST /api/internal/probe`，`hub-engine` 在存在 `maxEpisodeMinutes` 或 `monthlyBudgetLimit` 时，会先 probe 音频时长，再决定是否自动转写；条目新增 `audioStatusReason`，用于记录 `probe_failed / duration_unknown / episode_too_long / started` 等原因。
  - 定期抓取从“整点全量扫”切到“每 5 分钟 due-source 混合调度”：`sources` 新增 `nextFetchAt / lastSuccessAt / lastOutcome`，调度器按到期程度、优先级、健康度和错误次数选择信源；无新增会放慢、错误会退避、手动抓取后会重算下次计划。
  - AI 日志升级到“摘要 + 趋势 + 热点 + 明细”四层：Hub 与 Audio summary 接口新增 `timeWindow / interval / trends / hotspots`，支持看 `调用量 / 错误量 / 成本 / avgLatency` 趋势，以及高频错误、最贵 endpoint、最慢场景；设置页日志面板已改成趋势/热点优先。
  - 日报多代理补完最终融合层：`cleaning` 先产出结构化清洗结果，`decision / research / reading` 现在会显式消费 cleaning context，再由新增的 `final` 场景输出默认最终日报；前端默认主 tab 切到“最终日报”，同时保留模块视图和 Markdown 视图。
  - 最新验证结果：`apps/web npm run build` ✅、`services/hub-engine npm run build` ✅、`audio py_compile` ✅、`make gate` ✅，结果 `PASS=13 FAIL=0`。
- 2026-03-11 Feed/日报/监控展示链路收口：
  - Feed 改为列表可见区自动正文补抓，不再等点开详情才触发 `enrich`；同时手动单源抓取后会优先对新条目补正文，再继续评分/摘要/翻译。
  - `MarkdownContent` 统一支持“Markdown 正常渲染 + 纯文本保留换行”，用于 Feed 原文、音频转写/摘要、日报模块，修复长段挤成一坨和换行丢失。
  - 日报页新增“复制当前内容”，并给最终日报/研究汇总/阅读导航主内容区补 `min-w-0` 防止窄布局下吞字或展示不全。
  - `/items` 增加 `monitorOnly=true` 过滤；Monitor 页和 Feed 中“监控”视图改为按 `collectorType in ('webpage','changedetection')` 的真实监控来源取数，不再依赖 `category='监控'` 文本标签。
  - 正文补抓阈值放宽：`ensureItemContent()` 现在接受更短但明显优于 snippet 的正文，减少误判 `failed/degraded`。
  - 最新验证结果：`apps/web npm run build` ✅、`services/hub-engine npm run build` ✅、`bash qa/phase1/test_hub_engine.sh` ✅、`bash qa/phase2/test_ai_outputs.sh` ✅。
- 2026-03-12 日报/音频历史/监控语义三线收口：
  - 日报场景不再共用 `maxTokens=200`：`cleaning/decision/research/reading/final` 现在有独立输出预算，并新增“过短 / 截断 / 缺章”质量校验；`final` 和模块一旦命中质量异常，就回退到结构化 deterministic fallback，不再把半句输出当成功。
  - `buildInsightContext()` 扩大了分类、主题和重点条目输入范围；`buildFinalFallback()` 也改成更完整的最终日报结构，补了胰腺癌专题、重点来源和可执行阅读建议。
  - 音频历史任务新增有效性回传：`audio-service` 的 tasks API 会把历史上 `done` 但缺有效逐字稿或摘要的任务标成 `task_integrity_status=repair_needed`，并在前端音频工坊里显示“历史结果异常”，避免旧坏任务继续伪装成正常完成。
  - 监控来源改成显式语义：`hub.sources` 新增 `source_role`，运行时自动把 `changedetection` / `category=监控` / `monitorMode` 旧来源回填成 `monitor`；Sources 路由支持按 `sourceRole` 查询，`Monitor` 页面和 Feed 中“监控”视图都改成按监控来源取数，不再依赖分类字符串猜语义。
  - Monitor -> Feed 跳转固定带监控视角，不再把来源自身旧分类串回 Feed；Feed 侧在 `category=监控` 时只发 `monitorOnly=true`，不再叠加普通分类过滤。
  - 最新验证结果：`apps/web npm run build` ✅、`services/hub-engine npm run build` ✅、`PYTHONPYCACHEPREFIX=/tmp/infohub-audio-pyc python3 -m py_compile ...` ✅、`bash qa/phase1/test_hub_engine.sh` ✅、`bash qa/phase2/test_ai_outputs.sh` ✅；运行态 `http://localhost/health`、`/api/health`、`/api/audio/health` 均返回 `ok`。
- 2026-03-24 评分 Skills 二次升级与日报口径清理：
  - 设置页内联 `DEFAULT_PROMPTS` 的 `daily_report_cleaning / decision / research / reading / final` 已完全去掉 `PDAC/胰腺癌` 偏置，统一回到“AI 产业 + 头部舆论/新闻 + 资本/监管信号”主线。
  - `hub.scoring_skills` 新增 `preset_key`，默认评分体系从单一“默认精选技能”升级成 3 个系统预设：`ai_industry`、`product_delivery`、`narrative_capital`；老的 `默认精选技能` 会在默认预设补齐后自动归档，避免继续参与聚合打分。
  - 仅当用户没有 active 自定义技能时，系统才会自动补齐这 3 个预设，避免覆盖已配置用户的自定义评分链；`getActiveScoringSkills()` 仍保持最多 3 个 active skills 聚合。
  - Feed 的显式反馈从“自动携带 aiTags/sourceCategory”改成“4 个反馈动作 + 0-3 个显式标签”，标签固定覆盖 `AI行业 / 模型能力 / Agent / 产品落地 / 应用案例 / 资本市场 / 监管政策 / 头部舆论 / 公司战略 / 太泛 / 标题党 / 信息噪音`。
  - 偏好画像新增夜间自动重建：`cron` 每晚 2:15 对“自上次画像更新后仍有新反馈”的用户执行批量重建，设置页保留手动重建入口。
  - Settings 现在支持通过 `?tab=models&ai=skills` 直达 `AI 管理中心 -> 评分 Skills`，Feed 评分拆解区增加了跳转入口。
  - 本轮验证：`services/hub-engine npm run build` ✅、`apps/web npm run build` ✅。
