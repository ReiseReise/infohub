---
title: 信息中枢 v3
type: project
status: active
version: 3.0
created: 2026-02-28
tags: [信息中枢, 管道架构, 全渠道, 24/7]
---

# 信息中枢 v3 — 全渠道信息管道系统

> 全渠道信息采集→处理→结构化知识库的 24/7 管道系统。当前已形成“原生抓取 + Scrapling 动态兜底 + 30 天历史裁剪”的长期运行基线。

---

## 我的信息半径

已接入私有 Meilisearch 的全量全文检索。主导航「我的信息半径」已提供入口：[打开信息半径](http://localhost/radius)。登录后可先预览证据，再发起 AI 问答；支持前后时段比较、原文阅读、来源覆盖与转写缺口。也可切到浏览与搜索，严格匹配为默认，旧独立地址自动跳转。

关注源仍在原信源管理维护；新增主题可持续匹配历史和新增内容。已有正文、转写、未读及信息流过滤内容均进入索引。只读 Agent 接口、渠道边界、部署与回退见 [使用说明](scripts/radius/README.md)。本机维护已启用的组合服务时使用 `bash scripts/radius/compose.sh`，以保留 Meilisearch、同步器及私有密钥挂载；下方通用启动命令用于未启用该可选层的新环境。

## 快速启动

```bash
# 1. 复制环境变量
cp .env.example .env
# 编辑 .env 填入密码等

# 2. 启动完整栈（含默认统一入口）
docker compose up -d --build

# 3. 验证
docker compose ps                    # 所有容器 healthy
curl http://localhost/health         # Nginx 统一入口
curl http://localhost/api/health     # hub-engine 健康检查
curl http://localhost/api/audio/health  # audio-service 健康检查
curl http://localhost:8010/health    # scrapling-service 动态抓取兜底层
curl -i http://localhost/rsshub/        # 未挂载 Ops 凭据时预期 401
curl -i http://localhost/cd/            # 未挂载 Ops 凭据时预期 401
curl -i http://localhost/ntfy/v1/health # 未挂载 Ops 凭据时预期 401
psql -h localhost -U postgres -d infohub -c "SELECT schema_name FROM information_schema.schemata WHERE schema_name IN ('auth','hub','audio','quota');"
```

### 安全默认值与 Ops 鉴权

- 统一入口默认只监听 `127.0.0.1`；确需局域网访问时，再显式修改 `INFOHUB_BIND_ADDRESS`，并先确认主机防火墙与鉴权边界。
- 注册和所有无人值守的付费 AI 工作默认关闭。只有把 `ALLOW_REGISTRATION`、`AI_PROCESSING_ENABLED` 及所需 AI 子开关精确设为 `true` 才会启用；手动日报、手动翻译和手动音频操作不受自动总闸影响。
- 干净构建只包含一个不可登录的 `disabled:!` Ops 凭据占位符，因此 `/rsshub/`、`/cd/`、`/ntfy/` 和 `/reader-lab/proxy*` 默认拒绝访问。
- 需要 Ops 页面时，在部署主机准备被 Git 忽略的 `local-secrets/ops.htpasswd`，把 `docker-compose.ops-auth.yml.example` 复制为 `docker-compose.ops-auth.yml`，然后显式叠加该文件启动：

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.ops-auth.yml \
  up -d --build
```

不要提交真实 `docker-compose.ops-auth.yml`、`local-secrets/` 或 `.env`。

### 本机存储约定

- 当前设备的运行态数据通过私有 `.env` 指向 `local-data:I10/runtime`，也就是 `~/Library/Application Support/AIReise/data/I10/runtime`；项目内旧 `data/` 暂时只作迁移回退，不再由容器写入
- 导出目录默认是 `HOST_EXPORT_ROOT=./exports`
- 备份目录默认是 `HOST_BACKUP_ROOT=./backups`
- `data/pg`、`data/redis` 不建议拿网盘实时同步；请走快照备份
- `data/knowledge`、`exports/` 可以按需同步到本地同步盘
- 机器数据指针以项目注册表为准：`python3 共享工作台/底层逻辑/01_当前系统/治理/scripts/datactl.py resolve-project I10 source`（`runtime`、`derived` 同理）。当前 source 精确指向 `data/audio-uploads`；热数据尚未迁移，不要手工改成百度路径。

### 备份与归档

```bash
make portable-backup
make install-launchd-backup
```

- `make portable-backup`：生成 portable 快照，并按配置归档到 OSS
- `make install-launchd-backup`：在 Mac 上安装每日备份的 `launchd` 任务
- 存在 `.env` 时默认必须配置 `PORTABLE_PASSPHRASE`；只有显式 `--plain-env` 才允许明文逃生口，`BACKUP_ALLOW_PLAINTEXT=true` 是定时备份中与该参数等价的用户显式批准开关

## 单仓库迁移

这个仓库现在按 3 个模块做迁移：

| 模块 | 内容 | 说明 |
|------|------|------|
| `01-system` | 系统功能骨架 | 通过 Git 获取代码，通过迁移包补运行清单 |
| `02-config` | 敏感配置 | 根目录 `.env`；默认加密，明文必须显式授权 |
| `03-data` | 订阅数据 + 导出数据 | PostgreSQL dump + `data/knowledge`、`data/audio-uploads`、`data/changedetection`、`data/ntfy` |

`01-system/docker-compose.template.yml` 是仓库内 Compose 模板的原样副本。导出器不运行 `docker compose config`，不会把 `.env` 展开后的值写进 system 模块或日志。

导出迁移包：

```bash
make portable-export
PORTABLE_PASSPHRASE='your-passphrase' make portable-export
# 仅在已接受明文风险时：bash scripts/portable/export-bundle.sh ./portable-bundles --plain-env
```

恢复迁移包：

```bash
make portable-import BUNDLE=./portable-bundles/infohub-v3-portable-<timestamp>.tar.gz YES=1
```

详细说明见：[运维与使用手册](./docs/05-运维与使用手册.md)

---

## 架构概览

```
信源层 → 采集层(Cron+队列+Scrapling兜底) → 处理层(去重/过滤/AI) → 存储层(PG+文件) → 输出层(Web/日报/推送/Obsidian)
```

**详细设计**：[`docs/01-顶层架构设计.md`](./docs/01-顶层架构设计.md)

---

## 容器清单（Phase 0）

| 服务 | 镜像 | 端口 | 用途 |
|------|------|------|------|
| postgres | pgvector/pgvector:pg16 | 5432 | 核心存储 + 向量 |
| redis | redis:7-alpine | 6379 | 任务队列 + 缓存 |
| rsshub | diygod/rsshub | 1200 | RSS 桥接 |
| changedetection | changedetection.io | 5555（统一入口 `/cd/`） | 网页变更监控 |
| scrapling-service | 本地构建 | 8010 | 动态网页抓取 / 网页快照兜底 |
| ntfy | binwiederhier/ntfy | 8081 | 自建推送 |
| hub-engine | 本地构建 | 3001（统一入口 `/api/*`） | 核心后端 API |
| audio-service | 本地构建 | 8000（统一入口 `/api/audio/*`） | 音频转写与总结 |
| nginx | 本地构建 | 80 | 默认统一入口与静态前端 |

---

## 目录结构

```
信息中枢-v3/
├── docker-compose.yml         # Docker 全栈
├── .env.example               # 环境变量模板
├── nginx/                     # Nginx 默认统一入口
├── services/
│   ├── hub-engine/            # 核心引擎（Phase 1+）
│   ├── audio/                 # 音频服务（Phase 4+）
│   └── scrapling/             # 动态网页抓取兜底服务
├── apps/web/                  # React 前端（Phase 3+）
├── scripts/                   # 数据库初始化/迁移/运维
│   └── portable/              # 单仓库迁移导出/导入脚本
├── qa/                        # QA 测试
├── data/                      # Docker 卷（git忽略）
└── docs/                      # 项目文档
```

---

## 文档入口

| 文档 | 位置 |
|------|------|
| **🎯 当前执行状态** | **[`docs/36-信息中枢V3可信可用收口任务跟踪.md`](./docs/36-信息中枢V3可信可用收口任务跟踪.md)** |
| **📚 文档总导航** | **[`docs/00-文档总导航.md`](./docs/00-文档总导航.md)** |
| **🏗️ 顶层架构设计** | **[`docs/01-顶层架构设计.md`](./docs/01-顶层架构设计.md)** |
| **🧭 当前状态 / 功能地图** | **[`docs/02-当前状态与功能地图.md`](./docs/02-当前状态与功能地图.md)** |
| **🛣️ 路线图 / 优化计划** | **[`docs/03-路线图与优化计划.md`](./docs/03-路线图与优化计划.md)** |
| **🧩 关键实现专题** | **[`docs/04-关键实现专题.md`](./docs/04-关键实现专题.md)** |
| **🛠️ 运维与使用手册** | **[`docs/05-运维与使用手册.md`](./docs/05-运维与使用手册.md)** |
| **✅ 质量门禁与测试规范** | **[`docs/06-质量门禁与测试规范.md`](./docs/06-质量门禁与测试规范.md)** |
| **🗺️ HTML 总览板** | **[`docs/07-总览仪表板.html`](./docs/07-总览仪表板.html)** |
| **🗂️ 归档中心** | **[`docs/归档/00-归档导航.md`](./docs/归档/00-归档导航.md)** |
| **✅ QA 报告索引** | **[`qa/reports/index.md`](./qa/reports/index.md)** |

现在的 `docs/` 已经简化成“少数主文档 + 统一归档”的结构，不再保留 `design/`、`product/`、`operations/`、`manuals/` 等活跃目录壳。

## 运行治理补充

- 当前默认是`本地手动启动`模式：如果整套容器未运行，系统不会持续抓取；重新启动后，`hub-engine` 会先补抓一轮到期来源，再回到 5 分钟混合调度。
- 现在可以在 `/feed`、`/sources`、`/settings` 直接看到数据新鲜度状态；如果看到 `warning / stale`，优先执行“立即补抓到期来源”。
- 动态网页正文和网页快照监控采用“原生提取优先，Scrapling 失败兜底，必要时 browser-assist 再兜一层”的分层策略。
- `AI_PROCESSING_ENABLED` 是无人值守付费 AI 工作的总闸：关闭时不自动评分、摘要、翻译、生成 cron/startup 日报或触发信源自动转写，已经排队的自动日报也会在调用模型前跳过；手动日报、手动翻译和手动音频仍可用。总闸开启后，评分、摘要和翻译还要分别满足对应子开关及用户设置。
- 历史数据默认只保留最近 30 天；收藏、稍后读和仍被保留条目引用的音频任务不会被直接清理。
- AI 管理中心现在分成 `场景控制台 / 模型仓库 / 评分 Skills / 使用日志` 四层；模型支持人类可读 `alias`，Skills 不再埋在“功能管理”深处。
- 管理员可在 `Settings > 诊断中心` 查看 Scrapling 健康状态、抓取新鲜度和最近一次历史裁剪结果。

### 门禁入口

```bash
make gate
```

执行内容：Hub/Web/Audio 单元测试 + Web lint + 后端/前端构建 + Portable 配置/artifact/import 安全策略 + Docker 构建上下文安全策略 + QA 关闭策略测试 + 严格文档检查。默认门禁不调用会产生运行态副作用的 QA 回归。

集成 QA 当前状态：

- `qa-verify`、`qa-full`、`gate-integration` 暂时无条件拒绝执行。
- 现有 full suite 仍含硬编码热容器和服务默认值，项目尚未提供完整隔离 runner 与依赖清单；不能仅靠 `QA_ISOLATED=1` 宣称安全。

其他常用命令：

```bash
make qa-real-audio # 真实平台音频 URL 烟测（独立入口，不纳入默认 gate）
make acceptance-users # 准备管理员/普通用户验收账号
make portable-export # 导出单仓库迁移包
make portable-import BUNDLE=./portable-bundles/infohub-v3-portable-xxxx.tar.gz YES=1
```

---

## 历史实施阶段基线

> 下表只保留早期 Phase/Stage 交付记录，不代表当前稳定性或产品验收结论。当前任务、风险和最新证据只以 [`docs/36-信息中枢V3可信可用收口任务跟踪.md`](./docs/36-信息中枢V3可信可用收口任务跟踪.md) 为准。

| Phase | 内容 | 状态 |
|-------|------|------|
| **0** | 基础设施 + Docker + DDL | ✅ 完成 (30/30 PASS) |
| **1** | 核心采集+处理引擎 (hub-engine) | ✅ 完成 (19/19 PASS) |
| **2** | AI处理 + 输出层 | ✅ 完成 (19/19 PASS) |
| **3** | 统一前端 (React + Vite + TailwindCSS) | ✅ 完成 (34/34 PASS) |
| **4** | 扩展采集器 + Webhook | ✅ 完成 (22/22 PASS) |
| **5** | 向量化 + 知识库检索 | ✅ 完成 (13/13 PASS) |
| **6** | 部署 + 运维脚本 | ✅ 完成 |
| **A** | 数据迁移 + 信源上线 (555源, 17K+文章) | ✅ 完成 (11/11 PASS) |
| **B+C** | AI处理(qwen-turbo) + 前端增强 | ✅ 完成 (13/13 PASS) |
| **累计** | **Phase 0-6 + Stage A-C** | **161+ QA PASS** |
