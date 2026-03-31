# Changelog

## [v3.1.4] - 2026-03-19

### Changed

- `services/hub-engine`：新增启动后一轮 due-source catch-up，并把抓取新鲜度统一收口到 `/api/fetch/status`。
- `services/hub-engine` / `apps/web`：Feed、Sources、Settings 现在都能看到 `fresh / warning / stale` 相关新鲜度状态。
- `apps/web/src/features/settings/page.tsx`：AI 管理中心重构为 `场景控制台 / 模型仓库 / 评分 Skills / 使用日志` 四分组。
- `services/audio`：模型配置新增 `alias` 字段，用于人类可读别名。

### Added

- 新增 `docs/归档/评审/2026-03-19-项目评审_数据新鲜度与AI治理.md`。

### Verification

- `services/hub-engine npm run build`
- `apps/web npm run build`

## [v3.1.3] - 2026-03-04

### Added

- 新增 P0 回归脚本：
  - `qa/p0/test_rss_content_integrity.sh`
  - `qa/p0/test_audio_url_async_lifecycle.sh`
- 新增迭代归档：
  - `docs/archives/iterations/2026-03-04-RSS与音频异步回归加固.md`

### Changed

- `scripts/qa/run-regression.sh`：`--full` 套件新增 P0 回归阶段，纳入 `make gate`。
- `qa/reports/index.md`：更新到 2026-03-04 12:01 最新全量基线。

### Fixed

- 修复 `services/audio/app/tasks/audio_pipeline.py` 中 `summary_result` 原地修改导致的 `download_stage` 不回写问题。
- 修复音频链接失败时阶段长时间停留 `queued` 的可观测性缺陷。

### Verification

- `bash qa/p0/test_rss_content_integrity.sh` PASS（11 PASS / 0 FAIL）
- `bash qa/p0/test_audio_url_async_lifecycle.sh` PASS（6 PASS / 0 FAIL）
- `make gate` PASS（报告：`qa/reports/20260304_120707-full.md`）

## [v3.1.2] - 2026-03-03

### Added

- 新增 Feed 条目一键转写接口：`POST /api/items/:id/audio-transcribe`。
- 新增音频回调接口：`POST /api/hooks/audio-callback`，支持条目状态与结果回写。
- 新增迭代/发布归档：
  - `docs/archives/iterations/2026-03-03-Feed音频联动闭环.md`
  - `docs/archives/releases/v3.1.2-feed-audio-linkage-closure.md`

### Changed

- `services/hub-engine/src/config/index.ts` 增加音频联动配置：
  - `AUDIO_SERVICE_URL`
  - `HUB_ENGINE_INTERNAL_URL`
  - `AUDIO_WEBHOOK_SECRET`
- `services/audio/app/api/tasks_from_url.py` 将 `article_id` 扩展为字符串（兼容 Feed UUID）。
- `apps/web/src/pages/Feed.tsx` 增加播客转写操作、状态可视化、任务跳转入口。
- `apps/web/src/pages/AudioStudio.tsx` 支持 `taskId` 深链接。

### Fixed

- 修复 Feed 与音频任务的链路断点：从“可单独音频处理”升级为“条目级触发 + 结果回写”。
- 修复音频任务失败时 Feed 长时间停留在 processing 的问题（失败回调补齐）。

### Verification

- `cd services/hub-engine && npm run build` PASS
- `cd apps/web && npm run build` PASS
- `PYTHONPYCACHEPREFIX=/tmp/pycache python3 -m compileall services/audio/app` PASS
- `make gate` PASS（报告：`qa/reports/20260303_141853-full.md`）

## [v3.1.1] - 2026-03-03

### Added

- 音频链接抓取统一失败码：`DOWNLOAD_TIMEOUT/URL_UNSUPPORTED/DOWNLOAD_FORBIDDEN/MEDIA_NOT_FOUND/DOWNLOAD_FAILED`。
- 新增来源追踪字段（来源类型、抓取策略、失败码）并打通到前端详情展示。
- 新增迭代归档：`docs/archives/iterations/2026-03-03-音频链接抓取增强与文档中文化.md`。

### Changed

- `services/audio/app/services/podcast_service.py`：下载策略重构为 `yt_dlp + direct_http + page_extract + xiaoyuzhou_extract` 多兜底。
- `services/audio/app/api/tasks.py` 与 `services/audio/app/api/tasks_from_url.py`：任务创建时注入 `_source_meta`，失败返回统一格式。
- `services/audio/app/tasks/audio_pipeline.py`：`_source_meta/_callback` 在 Step1-5 全链路透传，避免中间状态覆盖。
- 设计文档主引用全面中文化，新增并扩展能力地图：`docs/design/16-平台功能地图_实现状态总览.md`。
- `scripts/docs/check-docs.sh` 增加中文主文档检查项（含 16 号能力地图）。

### Fixed

- 修复部分播客页面链接无法解析音频的问题（增加页面 HTML 抽取与小宇宙专门兜底）。
- 修复链接抓取失败时前端不可定位根因的问题（返回 failure code + detail）。

### Verification

- `PYTHONPYCACHEPREFIX=/tmp/pycache python3 -m compileall services/audio/app` PASS
- `make gate` PASS（报告：`qa/reports/20260303_132257-full.md`）

## [v3.1.0] - 2026-03-03

### Added

- 恢复并接入 `services/audio` 音频服务代码（任务、提示词、模型配置、URL 抓取）。
- 新增 `audio-service` 与 `audio-worker` 编排配置（`docker-compose.yml`）。
- 前端新增音频工坊页面：`/audio`（上传、链接抓取、任务详情）。
- 新增音频模块文档：`docs/modules/05-audio-workflow.md`。
- 新增迭代/发布归档：
  - `docs/archives/iterations/2026-03-03-audio-workflow-integration.md`
  - `docs/archives/releases/v3.1.0-audio-workflow-and-gateway.md`

### Changed

- `nginx/nginx.conf` 与 `apps/web/vite.config.ts` 补齐 `/api/audio/*` 到 audio-service 的路径重写。
- `apps/web/src/lib/api.ts` 增加音频任务 API 与上传进度能力。
- `apps/web/src/components/Sidebar.tsx` 与 `apps/web/src/App.tsx` 增加音频工坊入口与路由。
- `docs/design/13-v3能力差距分析.md` 同步当前能力状态。
- `qa/phase3/test_frontend.sh` 增加 `AudioStudio.tsx` 检查项。

### Fixed

- 修复“音频工坊点击无响应”的核心路由缺失问题。
- 修复音频服务对外部 JWT 首次访问时用户不存在导致的鉴权失败（自动映射用户）。
- 修复 Markdown 渲染器对图片语法 `![alt](url)` 不支持问题。

### Verification

- `make build-engine` PASS
- `make build-web` PASS
- `bash qa/phase3/test_frontend.sh` PASS
- `make gate` PASS（报告：`qa/reports/20260303_122907-full.md`）
- `PYTHONPYCACHEPREFIX=/tmp/pycache python3 -m compileall services/audio/app` PASS

## [v3.0.1] - 2026-03-02

### Added

- 新增归档中心与双层归档体系：`docs/archives/{stages,iterations,releases}`
- 新增归档模板与 QA 模板：`docs/templates/*`
- 新增质量门禁与归档治理文档：
  - `docs/design/14-质量门禁规范.md`
  - `docs/design/15-归档治理规范.md`
- 新增运维文档：
  - `docs/operations/runbook.md`
  - `docs/operations/troubleshooting.md`
  - `docs/operations/rollback.md`
- 新增用户与管理员手册：
  - `docs/manuals/user-guide.md`
  - `docs/manuals/admin-guide.md`
- 新增 QA 报告索引：`qa/reports/index.md`
- 新增自动化脚本与门禁入口：
  - `scripts/docs/init-archive.sh`
  - `scripts/docs/check-docs.sh`
  - `scripts/qa/run-regression.sh`
  - `Makefile`

### Changed

- QA 脚本统一鉴权（phase2/4/5/stage-a/stage-bc）
- `sources/import-opml` 缺参场景返回码修复为 400
- README 与索引文档增加归档中心与门禁导航

### Fixed

- 修复 `embedder.ts` 对 `embedding` 列类型引用导致的编译报错
- 修复 `items.ts` 查询条件类型导致的编译报错

### Notes

- 本版本以“工程治理与可交付”增强为主，不包含业务能力扩展。
