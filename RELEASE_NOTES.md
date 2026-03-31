# Release Notes

## v3.1.4+ — 状态收口与主链路增强汇总（2026-03-10）

## 概述

该汇总版本用于覆盖 2026-03-06 到 2026-03-10 之间连续完成的主链路增强与治理收口。  
这几轮变化已经真实落地到代码、运行配置和回归门禁，但此前没有及时同步到统一的发布说明与状态文档中。

## 主要更新

1. 安全收口：
   - 默认密钥与默认管理员凭证不再允许以弱默认值长期运行。
   - 内部接口补充内部鉴权，Nginx 不再公开暴露内部专用路径。
   - 普通用户不再读取管理员侧的敏感 AI 配置字段。
   - webhook 回调默认收口到显式 secret。
   - 知识库导出目录与持久化挂载路径对齐。
2. 音频主路径修复：
   - 运行态默认切回 `OSS + 远程批量 ASR`。
   - 长音频不再默认走本地 realtime Paraformer。
   - 音频任务详情补齐存储后端、抓取策略、失败原因与阅读工作台。
3. Feed 富化：
   - 新增 `content_status / summary_status / translation_status` 诊断字段。
   - 新增 `POST /api/items/:id/enrich`，支持正文补抓与必要的重评分/重摘要/重翻译。
   - 前端详情改为诊断优先，并统一使用正式 Markdown 渲染。
4. 日报与 AI 治理：
   - 日报从单段摘要升级为 `cleaning / decision / research / reading` 多代理结构化流水线。
   - AI 管理中心支持更细的场景管理与使用日志展示。
5. 豆包与调用日志：
   - `volcengine_ark` 改成 endpoint-only 语义，标准字段为 `DEFAULT_LLM_ENDPOINT_ID=ep-*`。
   - AI 使用日志新增 `endpointId / totalTokens / latencyMs / providerRequestId / apiKind / promptPreview / responsePreview`。
6. 配置治理：
   - `.env.example` 与运行态 `.env` 已按“基础设施 / 功能开关 / 厂商配置 / 兼容字段”重组。
   - 豆包最小必填组合明确为 `ARK_API_KEY + ARK_BASE_URL + DEFAULT_LLM_ENDPOINT_ID`。

## 兼容性

- 无业务 API 破坏性删除，但部分接口返回值已增强。
- `volcengine_ark` 现以 endpoint id 为标准语义，不建议继续使用旧的“模型名占位值”。
- `DOUBAO_ENDPOINT_ID` 仍保留兼容，但推荐迁移到 `DEFAULT_LLM_ENDPOINT_ID`。

## 验证结果

- `apps/web` build ✅
- `services/hub-engine` build ✅
- `services/audio` py_compile / compileall ✅
- `bash qa/p0/test_audio_url_async_lifecycle.sh` ✅
- `bash qa/phase2/test_ai_outputs.sh` ✅
- `bash qa/p0/test_frontend_e2e_folo.sh` ✅
- `bash scripts/docs/check-docs.sh --strict` ✅
- `make gate` ✅ `PASS=13 FAIL=0`

## v3.1.3 — RSS 与音频异步回归加固（2026-03-04）

## 概述

该版本聚焦“主链路可回归”：修复音频链接任务阶段回写缺陷，并把 RSS 完整性与音频异步生命周期升级为 P0 自动化回归，纳入全量门禁。

## 主要更新

1. 修复音频 `from-url` 阶段状态写回：
   - `download_stage` 不再停留 `queued`，失败会正确落为 `failed`。
2. 新增 `qa/p0/test_rss_content_integrity.sh`：
   - 覆盖 `content:encoded`、来源字段、媒体字段、详情正文完整性。
3. 新增 `qa/p0/test_audio_url_async_lifecycle.sh`：
   - 覆盖“立即建任务 + 后台执行 + 失败码可观测”。
4. `scripts/qa/run-regression.sh --full` 增加 P0 阶段，`make gate` 自动执行。

## 兼容性

- 无数据库 schema 变更
- 无破坏性 API 变更
- 仅增强状态回写一致性与回归覆盖范围

## 升级步骤

1. 更新代码并重建音频服务：
   - `docker compose up -d --build audio-service audio-worker`
2. 执行门禁：
   - `make gate`

## 验证结果

- 全量门禁 PASS：`qa/reports/20260304_120707-full.md`
- P0 RSS 回归 PASS：11 PASS / 0 FAIL
- P0 音频异步回归 PASS：6 PASS / 0 FAIL

## v3.1.2 — Feed 音频联动闭环（2026-03-03）

## 概述

该版本聚焦“跨模块可用性闭环”：在 Feed 详情页直接触发播客转写，并将音频任务状态与结果自动回写到条目，真正打通 Feed 与 Audio 两条链路。

## 主要更新

1. 新增 `POST /api/items/:id/audio-transcribe`：单条 Feed 一键触发转写。
2. 新增 `POST /api/hooks/audio-callback`：回调写回 `audioStatus/transcript/knowledge/audioDuration`。
3. 音频失败回调补齐：失败状态不再卡在 processing。
4. 前端增强：Feed 详情支持播客转写、状态展示、跳转到 `/audio?taskId=...`。
5. 深链接增强：AudioStudio 支持 `taskId` 直达任务。

## 兼容性

- 无数据库 schema 变更
- 无破坏性 API 变更（新增接口与字段）
- 新增可选环境变量：`AUDIO_SERVICE_URL/HUB_ENGINE_INTERNAL_URL/AUDIO_WEBHOOK_SECRET`

## 升级步骤

1. 更新代码并补齐环境变量（如需启用回调验签可设置 `AUDIO_WEBHOOK_SECRET`）。
2. 执行门禁：`make gate`
3. 重启相关服务：`docker compose up -d --build hub-engine audio-service audio-worker web`

## 已知问题

1. 自动转写策略（基于规则和配额自动触发）尚未落地，当前仍为手动触发。
2. Nginx 统一入口仍未默认启用。

## v3.1.1 — 音频链接抓取增强与文档中文化（2026-03-03）

## 概述

该版本聚焦“音频可用性与可排障性”：强化链接抓取兜底能力，统一失败码并在前端可见；同时完成设计文档主路径中文化与能力地图补全。

## 主要更新

1. 链接抓取增强：`yt_dlp + direct_http + page_extract + xiaoyuzhou_extract` 多策略兜底。
2. 失败分类标准化：统一 failure code，并在任务详情展示失败码与失败详情。
3. 来源元信息透传：任务链路全程保留来源类型与抓取策略。
4. 文档中文化：设计文档主路径统一中文命名，补齐平台功能地图。
5. 归档与门禁：新增迭代归档并通过全量门禁回归。

## 兼容性

- 无数据库 schema 变更
- 无破坏性 API 变更（新增字段为向后兼容）

## 升级步骤

1. 同步最新代码和文档。
2. 执行语法与门禁验证：
   - `PYTHONPYCACHEPREFIX=/tmp/pycache python3 -m compileall services/audio/app`
   - `make gate`
3. 重启相关服务：
   - `docker compose up -d --build audio-service audio-worker hub-engine web`

## 已知问题

1. Feed 条目与音频任务仍未完全条目级联动。
2. X/公众号等非 RSS 信源仍处于规划阶段。

## v3.1.0 — 音频工坊接入与网关打通（2026-03-03）

## 概述

该版本聚焦“可用性闭环”：把 v3 缺失的音频工作流接回产品主链路，用户登录后可直接使用上传/链接抓取、转写与总结能力。

## 主要更新

1. 音频服务接入：恢复 `services/audio` 并启用 `audio-service + audio-worker`
2. 网关打通：`nginx` 与 `vite proxy` 支持 `/api/audio/*` 到 audio-service 重写
3. 前端落地：新增 `/audio` 音频工坊页面与侧栏入口
4. 兼容修复：audio-service 支持 hub-engine JWT 首次访问自动用户映射
5. 文档归档：补齐模块文档、迭代归档、发布归档与 QA 报告索引

## 兼容性

- 无业务 API 破坏性变更
- 新增音频服务环境变量（见 `.env.example`）
- 无数据库 schema 变更

## 升级步骤

1. 拉取最新代码并同步 `.env`（音频相关配置）。
2. 执行构建与门禁：
   - `make build-engine`
   - `make build-web`
   - `make gate`
3. 启动音频相关容器：
   - `docker compose up -d --build audio-service audio-worker`

## 回滚步骤

1. 回退到上一稳定版本。
2. 停止新增音频容器并恢复旧网关配置。
3. 重新执行 `make gate` 验证回滚结果。

## 已知问题

1. 音频任务与 Feed 条目级联回写尚未完成（下一迭代处理）。
2. Nginx 服务仍未纳入默认 compose 启动链路。

## v3.0.1 — 归档治理与质量门禁增强（2026-03-02）

## 概述

该版本聚焦工程可交付能力：建立阶段/迭代归档规范、文档完备清单、严格质量门禁和自动化回归入口。

## 主要更新

1. 归档体系：新增 `docs/archives` 与标准模板
2. 治理规范：新增质量门禁与归档治理文档
3. 运维与手册：补齐 runbook、故障排查、回滚、用户/管理员手册
4. 自动化：新增归档初始化、文档检查、回归执行脚本与 Makefile 入口
5. QA 统一化：阶段脚本统一认证上下文，输出可追溯报告索引

## 兼容性

- 无业务 API 破坏性变更
- 无数据库 schema 变更
- 无前端路由变更

## 升级步骤

1. 拉取最新代码
2. 执行构建：
   - `cd services/hub-engine && npm run build`
   - `cd apps/web && npm run build`
3. 执行门禁：
   - `make gate`

## 回滚步骤

1. 回退到上一稳定版本
2. 重新构建并执行健康检查
3. 按 `docs/operations/rollback.md` 完成验证

## 已知问题

1. Stage A 脚本在“无迁移数据账号”下会出现较多 SKIP，这是预期行为。
2. Stage B+C 在“无 AI 配置账号”下会 SKIP AI 配置数量断言，这是预期行为。
