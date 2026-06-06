# 信息中枢 V3 Feed 详情入报解释验收记录

日期：2026-06-06
阶段：可信可用收口计划模块 3
范围：Feed 详情页、单条日报资格诊断、真实页面验收。

## 结论

Feed 详情页已补齐“为什么 Feed 可见但没有进入日报”的解释入口。此前用户只能在 Insights 候选池或日报快照里看到未入报原因；现在打开单条 Feed 详情即可看到同一套日报快照/候选规则给出的诊断、原因和下一步动作。

本轮修掉两个可信度问题：

1. 详情诊断 bounded sampling 可能因 `limit` 漏掉当前条目，导致误报“不在候选池”。现在会额外并入目标条目。
2. 详情页实时重算会受当前日报配置影响，可能和已生成日报快照不一致。现在优先用同日最新日报快照；没有有效快照时才使用当前规则预览。

真实样本矩阵：

| 样本 | 标题 | 诊断 | 依据 |
| --- | --- | --- | --- |
| selected_top | 算得更快更准 全球海洋现象智能预报大模型“琅琊”2.0发布 | 已进入日报 | 同日最新日报快照 |
| fallback_scored | Running Python code in a sandbox with MicroPython and WASM | 未入报：低置信评分 | 同日最新日报快照 |
| business_noise | 富途老虎长桥之后，未被“点名”的华盛证券也将清理内地业务 | 未入报：泛商业噪声 | 同日最新日报快照 |
| not_selected_snapshot | 证监会主席吴清：坚决遏制概念炒作、复杂嵌套、过度投机、通道空转等伪创新、乱创新 | 未入报：未达到候选门槛 | 同日最新日报快照 |

## 实现

### 后端

新增 `services/hub-engine/src/outputs/daily-report-item-diagnostic.ts`：

- 将单条 item 在日报候选准备结果中的位置归一成稳定诊断。
- 优先级：最终入报 > 排除诊断 > 复核候选 > 最新兜底 > 不在候选池。
- 关键原因包含 `fallback_scored`、`business_noise`、`translation_failed`、`not_chinese`、`not_selected`。

扩展 `GET /api/items/:id`：

- 按该条 `fetchedAt` 所在自然日读取日报工作流配置。
- 优先读取同日最新 `hub.insights` 日报快照，从 `topItems/excludedCandidates` 还原单条诊断。
- 没有有效日报快照时，复用 `prepareDailyReportCandidates` 计算同日候选池。
- bounded sampling 未命中当前详情条目时，额外查询并并入目标条目，避免误报“不在候选池”。
- 返回 `dailyReportDiagnostic`，前端无需另发请求。

### 前端

扩展 `FeedItemRecord` contract：

- 新增 `dailyReportDiagnostic` 字段。

Feed 详情页新增“日报解释”卡片：

- 显示诊断标签。
- 显示入报/未入报原因。
- 显示下一步动作。
- 显示诊断依据：`依据：同日最新日报快照` 或 `依据：当前日报规则预览`。
- 视觉状态复用 `ok/warning/danger/neutral` 色系。

## 测试

新增后端单测 `daily-report-item-diagnostic.test.ts`，覆盖：

- 已进入日报。
- 低置信兜底评分优先解释为 `fallback_scored`，即使它也在 reviewCandidates。
- 高分泛商业噪声解释为 `business_noise`。
- 同范围最新兜底。
- 不在当前候选窗口。
- bounded sampling 未命中目标条目时并入目标条目。
- 从已生成日报快照还原 TOP 与排除诊断，避免当前配置覆盖历史日报解释。

验证命令：

```bash
cd services/hub-engine
node --import tsx --test src/outputs/daily-report-item-diagnostic.test.ts src/outputs/daily-report-workflow.test.ts
npm test
npm run build
```

结果：

- 专项测试：`32/32` 通过。
- 后端全量：`145/145` 通过。
- 后端构建：通过。

```bash
cd apps/web
npm run build
```

结果：通过，仅保留 Vite chunk size warning。

```bash
git diff --check
```

结果：通过。

## 真实验收

API 探针：

```bash
node /private/tmp/infohub_feed_daily_diag_probe.mjs
```

结果：

- `selected_top`：`status=selected`，`diagnosticBasis=insight_snapshot`
- `fallback_scored`：`excludedReason=fallback_scored`，`diagnosticBasis=insight_snapshot`
- `business_noise`：`excludedReason=business_noise`，`diagnosticBasis=insight_snapshot`
- `not_selected_snapshot`：`excludedReason=not_selected`，`diagnosticBasis=insight_snapshot`

页面 E2E：

```bash
python3 /private/tmp/infohub_feed_daily_diag_e2e.py
```

结果：

- 页面可见四类样本的 `日报解释`
- 页面可见 `已进入日报`、`未入报：低置信评分`、`未入报：泛商业噪声`、`未入报：未达到候选门槛`
- 页面可见 `依据：同日最新日报快照`
- 截图：
  - `/private/tmp/infohub-feed-daily-report-diagnostic-selected_top.png`
  - `/private/tmp/infohub-feed-daily-report-diagnostic-fallback_scored.png`
  - `/private/tmp/infohub-feed-daily-report-diagnostic-business_noise.png`
  - `/private/tmp/infohub-feed-daily-report-diagnostic-not_selected_snapshot.png`

## 剩余风险

1. `GET /api/items/:id` 在没有有效日报快照时仍会重算该日候选池。bounded limit 已补目标条目并入，但真实日数据较大时仍需观察性能。
2. 当前真实数据没有 `translation_failed` 样本；这类诊断已有单测覆盖，后续等真实失败样本或 QA seed 再做页面验收。
3. 详情页现在优先显示历史快照诊断；如果用户想看“当前规则下会不会入报”，后续可以在卡片中增加第二行实时预览，但本轮先保证与已生成日报一致。

## 下一步

继续模块 4：日报主链路收口。

- 用同一批真实数据重新生成日报，核对 Feed 详情、Insights 候选池、最终 Markdown 三者一致。
- 抽查 10 条入报/未入报证据，重点看泛商业噪声、低置信评分、TOP 入报理由是否仍一致。
- 若模型供应商不稳定，优先补降级与失败可解释，不把外部模型波动混成代码缺陷。
