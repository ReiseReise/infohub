# 可信研究隔离验收

执行状态仍以 `docs/36-信息中枢V3可信可用收口任务跟踪.md` 为准。本目录不维护第二套进度。

## 固定输入与盲选

- `manifest.json` 固定三个历史窗口、48个事件分组、49篇原文、5个专题问题和原文包SHA-256。
- 原始材料存放于Git忽略的私有基线包，不提交或上传滴答。`freeze.sql`仅用于从已恢复的隔离库重建候选输入；冻结后不得覆盖基线包。
- 实际比较仍需分别运行旧引擎、结构化单次生成和Pi研究，全部使用DeepSeek Flash及同一冻结材料。历史原稿只作反例，不冒充同模型实验结果。
- 三个输出文件命名为`legacy.json`、`structured_once.json`、`pi_research.json`。每份包含`engine`、`model`、`fixtureSha256`、`totalCostMicros`、`runs`和`events`（runs中每份成果包含id与totalCostMicros，单份不超过10元，总额必须对得上）；事件包含`eventKey`、`markdown`和`elapsedMs`。缺失任一真实输出即拒绝生成盲选包。
- `compare.mts INPUT_DIR PRIVATE_OUTPUT_DIR`生成确定性打乱的盲选包、独立答案表和费用表。必须由Reise填写选择、严重错误和修改时间，平局不算新稿获选。

## 隔离实例

专用PostgreSQL：`127.0.0.1:55439/research_qa`；专用Redis：`127.0.0.1:55440`。不挂载生产卷。脚本校验目标后才运行；生产`index.ts`不用于验收服务。

从项目根运行（凭据见本地隔离实例配置，不用生产账号）：

```sh
RESEARCH_TEST_DATABASE_URL="$ISOLATED_PG_URL" node --import ./services/hub-engine/node_modules/tsx/dist/loader.mjs qa/research/store.integration.mts
RESEARCH_TEST_DATABASE_URL="$ISOLATED_PG_URL" node --import ./services/hub-engine/node_modules/tsx/dist/loader.mjs qa/research/pi-loop.integration.mts
node --import ./services/hub-engine/node_modules/tsx/dist/loader.mjs qa/research/api.integration.mts
```

`server.mts`仅监听3309，使用合成账号和资料，启动真实研究BullMQ Worker。启动必须同时设置隔离`DATABASE_URL`、`REDIS_URL`、测试`JWT_SECRET`、`NODE_ENV=test`及`TRUSTED_RESEARCH_ENABLED=true`。前端Vite以`VITE_API_PROXY_TARGET=http://127.0.0.1:3309`运行。

`pi-loop.integration.mts`替换模型响应，仍运行真实Pi SDK循环。它证明工程流程，不能作为真实模型、内容准确性或70%盲选的证据。API测试验证缺少凭据时真实暂停且费用为零。

## 回归范围

日期、署名、错链、占位沿用`daily-report*.test.ts`及`daily-report-quality.test.ts`。新增`src/research/*.test.ts`覆盖证据切片、预算、禁联网、未授权搜索和内网地址。集成脚本验证并发幂等、取消后迟到写入、恢复预算、稿件不可变、事件游标及认证。

尚不能用以上测试替代：真实DeepSeek与Brave调用、恶意真实网页工具循环、生产容器部署、完整日报兼容验收及三个自然日使用。

## 三引擎实际运行器

`run-comparison.mts`默认只展示计划，不加载凭据或调用模型：

```sh
node --import ./services/hub-engine/node_modules/tsx/dist/loader.mjs qa/research/run-comparison.mts --limit=20
RESEARCH_TEST_DATABASE_URL="$ISOLATED_PG_URL" node --import ./services/hub-engine/node_modules/tsx/dist/loader.mjs qa/research/run-comparison.mts --live --limit=1
```

- `--engine=legacy|structured_once|pi_research|all`，默认all；默认1事件，最多49个日期内事件单元。事件按稳定键排序；同一事件跨历史窗口的材料按日期拆分，禁止混入后来材料。`--resume-failed`只恢复有失败步骤且执行尝试少于3次的任务，不重跑仅因语义问题处于review的任务；`--resume`仅在明确需要重试失败/待审稿时使用，复用原run及预算；不带resume只执行未完成项并重新导出已有结果。
- 比较单位为**单事件**：旧方式复用现有清洗、三个模块、总编辑和成稿处理；结构化单次只调用一次；Pi进行研究/核对/修订。原文集合一致，各方式每次输出上限4096 token；旧方式沿用当前默认提示，不加载生产个性化场景模板。该比较不能替代整报组织或个性化配置验收。
- 冻结包SHA必须匹配。正文直接进入不可变证据表，不覆盖旧原文或依赖当前文章表正文。每个引擎的每个事件共享独立10元run预算；所有调用（含失败、重试）记账。旧方式已成功返回的同提示调用从持久记录复用。
- 隔离库必须是55439/research_qa；同一评测进程用数据库锁互斥；本轮额外限制整批累计预估加预留不超过10元。凭据仅在当前进程解密使用，不激活测试库模型配置。评测时仍应停用合成Worker，防止争抢阶段任务。
- 输出在私有`output/research-comparison-<fixture hash前12位>/`。数据库保存候选/阶段/费用，JSON按临时文件原子替换。中断保留原run；过期执行权由再次运行回收。只有显式live会产生新费用。
- 结果保持candidate/review，不能冒充内容验收或发布。盲选打包要求至少20个匹配事件、完整文本、无步骤执行错误、无未结算预留费用；人工仍需判断证据和事实。未满足条件不会补造缺失结果。

选材与旧接口适配新增 `selection.integration.mts` 和 `daily-adapter.integration.mts`，均使用RESEARCH_TEST_DATABASE_URL。前者验证复核不改事件、不入队、不扣费及去重；后者直接执行生产适配处理器，验证来源隔离、任务查询与同步调用进入持久任务服务，不冒充真实浏览器验收。

`tool-boundaries.integration.mts`通过实际Pi执行器尝试未提供的Shell/联网工具、越权原文和伪造引用，并确认6次工具尝试的开始/结束日志均已持久化；模型响应为合成攻击序列，不宣称真实模型抗注入通过。

修订与核对通过 `revise.ts` 的专用工具提交，各上下文最多3次尝试。`revise.test.ts`覆盖缺引用补正、伪造引用有界拒绝、执行撤销及核对额外字段纠正；通过工具结构校验仍需独立语义核对。`--event=<稳定事件键>`仅执行指定单元，导出仍保留选定范围已有结果，其他单元不重跑。
