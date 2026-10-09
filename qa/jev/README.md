# Jev 首轮小样本实验

学习正文：[整体能力与应用介绍](../../docs/40-Jev整体能力与应用学习介绍.md)。当前进度只在 [36 号执行真源](../../docs/36-信息中枢V3可信可用收口任务跟踪.md) 维护。

## 集成设计 demo 验证（2026-09-21，离线 + live）

`jev_design_rules.py` 对 [41 号集成设计](../../docs/41-Jev体验升级点集成设计.md) 第一/二批四个场景（监控过滤、富化分级、转写预判、同事件折叠）做了离线验证：问题定义符合 Jev API 形状、本地判断规则按文档阈值路由全部分支（正常值/边界值/低置信/材料不足/接口失败）、降级路径全部回落安全档。15 个 demo 场景 + 边界单测全过（`test_jev_design_rules.py`，套件共 50 项）。

同日完成 **live 验证**（`jev_design_live.py`）：11 个 API 场景全部成功（4+7 两次运行，账本幂等跳过已结算项），累计估算花费约 0.0005 美元，单次耗时 1.1–2.8 秒，与主实验中位数一致。9 个场景的动作路由与离线预期一致；2 处差异均为合理行为：其一，合成样例正文只有占位符，真实模型正确选择"材料不足"，规则按设计回落保守档；其二，高价值播客的评分高于 mock 假设但动作相同（优先转写）。

运行方式：

```sh
# 离线（无网络、无密钥）
PYTHONDONTWRITEBYTECODE=1 python3 qa/jev/jev_design_rules.py
# live（密钥在项目根 .env 的 TYPESAFE_API_KEY，0600 且被 git 忽略；只提取该变量，不整文件 source）
export TYPESAFE_API_KEY="$(grep '^TYPESAFE_API_KEY=' .env | cut -d= -f2-)" && \
PYTHONDONTWRITEBYTECODE=1 python3 qa/jev/jev_design_live.py
```

live 过程中发现并修正两处客户端假设错误（均有账本复核记录）：score 的 `probabilities` 是以档位序号为键的字典而非列表，且自带权威 `score` 加权字段（内部精度高于返回的舍入分布，校验只做范围检查不做一致性硬校验）。这两个事实已回写进校验器与单测，是 `jev-questions.ts` 生产实现的直接输入。

边界仍然明确：合成样本只验证链路、形状与规则路由，**不证明编辑判断准确率**（40 号文档第 9 节）；盲审闸门与"未接入生产"状态不变。

## 输入与边界

- 8 条中英文合成案例：`synthetic-cases.jsonl`，用于接口和边界检查，不是准确率测试集。
- 30 条公开资讯：项目登记的 derived 目录 `exports/jev-20260921/public-cases-v2.jsonl`。AI 技术、应用、政策资本各10条，每类中英文各5条。均来自近14天，无需扩大到30天。
- 固定标题和正文；三处正文片段匹配匿名公开页面，保留页面哈希。HTML/Markdown统一提取可见文字，无模型摘要或截断。公开性不等于事实核验或版权再发布授权。
- 来源和事件人工初筛，同时核对已有 cluster/dedup 字段、内容哈希与URL。定向小样本不是随机抽样；中文主要来自智东西，英文主要来自TechCrunch和Hugging Face，存在来源偏差。包含1篇Jev相关报道，不据此推断供应商优劣。
- 不向模型发送样本类别、历史分数、人工标签、阅读记录或私人偏好；不写数据库、不挂调度、不切换默认评分。

输入位于被Git忽略的项目登记导出目录，文件0600、实验目录0700。公开网页副本用于私有实验，不纳入公开交付。`public-cases.jsonl` 是早期未凑足的冻结检查，实际运行只用 `public-cases-v2.jsonl`。

## 执行入口

在项目根运行，需要Python 3，无新增全局依赖。以下每条命令使用同一个输出根。

```sh
# 测试，不调用真实模型
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s qa/jev -p 'test_*.py' -v

# 离线准备与预算估计
PYTHONDONTWRITEBYTECODE=1 python3 scripts/research/jev_experiment.py --phase public --cases exports/jev-20260921/public-cases-v2.jsonl --arms both --output-root exports/jev-20260921/run

# 真实合成接口验证，需要本机环境变量 TYPESAFE_API_KEY
PYTHONDONTWRITEBYTECODE=1 python3 scripts/research/jev_experiment.py --phase smoke --cases qa/jev/synthetic-cases.jsonl --output-root exports/jev-20260921/run --live

# 真实公开资讯对照；Jev缺密钥时明确跳过，基线可独立完成
PYTHONDONTWRITEBYTECODE=1 python3 scripts/research/jev_experiment.py --phase public --cases exports/jev-20260921/public-cases-v2.jsonl --arms both --output-root exports/jev-20260921/run --live

# 生成报告；双组齐全才生成盲审单
PYTHONDONTWRITEBYTECODE=1 python3 scripts/research/jev_report.py --cases exports/jev-20260921/public-cases-v2.jsonl --output-root exports/jev-20260921/run
```

旧 `jev-shadow.py` 保留离线兼容及基础校验函数，其 `--live` 已停用，避免绕过新账本。

## 模型与比较方式

Jev固定 `jev-1.13.0`，相关性与材料充分性用Noul，主题用Choice，三个价值视角用五档Score。

基线只读加载现有preferred的 `dashscope/qwen-plus` 配置，固定配置ID与默认国内接口，不切换Qwen Flash。凭证只在原audio容器内解密，独立脚本直接调用API；不经过生产评分、日志或调度处理器。数据库查询在只读事务中进行，不导入应用数据库初始化模块。

基线使用现有公开默认视角和82/62/35分档标准，把三视角合成一次请求，保留分数、置信度和理由。它是同模型、同公开标准的独立对照，**不是生产原调度或个性化评分的完全复刻**。关闭思考、温度0、最多1200输出tokens；截断或格式失败即停止。Jev不生成文字解释，不伪造理由。

两组内部按三个视角等权平均后排序，原始分数和confidence不横向比较。探索性的选中集合固定为Top10。低置信或不完整材料仍保留检查，不发生删除或正式过滤。

## 预算与恢复

同一 `run/ledger.jsonl` 管理8条合成和30条双组请求，总额度1美元。每次先fsync预留记录，再调用，再fsync成功或失败；进程锁防止并行重复调用。输入、问题、模型配置与价格快照冻结在manifest。

预留使用请求UTF-8字节数加2048的保守输入额度，以及基线1200输出token上限。Jev按每百万输入0.042美元估算；Qwen按每百万输入0.8、输出8美元的保守预算单价预留和结算，**不是实际账单单价**。超过单次预留会中止并标记异常；失败或未知请求保留预留额。费用不能作为降本30%的证据，需实际计价核对；耗时可独立比较。

参考：[Jev官方价格](https://docs.typesafe.ai/models)、[Qwen型号价格](https://help.aliyun.com/zh/model-studio/qwen-plus)。快照日期2026-09-21；换型号或价格必须重新核对。

成功请求重启时跳过；failed/reserved记录阻止后续调用，须先人工核对，不自动重试，不通过新建目录规避预算或失败审查。缺密钥不发请求。密钥不要进入聊天、CLI参数或同步文件。

## 报告与盲审

`run/REPORT.md` 和 `comparison.json` 展示逐条状态、语言分组耗时、用量及保守费用估计。只有30条双组成功后，才从排名分歧最大5条和剩余固定哈希抽取5条生成 `blind-review.json`。顺序再次打乱，不显示模型身份、排名或选择理由；映射另存 `blind-key.json`。重复生成报告不会覆盖已有人工标签。

填写label：值得读 / 一般 / 不值得读。10条全部反馈后，统计“值得读但不在Top10”的漏选数。Jev漏选不多于基线且中位耗时改善至少30%时，建议扩大正式评测；否则调整或停止扩量。成本比较待账单单价核对，当前不用于通过门槛。此处不产生生产质量验收通过结论。

缺真实结果、人工标签或完整样本时，相应结论必须留空。不能用离线测试或模拟响应填补。

## 2026-09-22 全场景代码接入

当前全场景实现、使用入口、工程验收与效果限制见 [实施验收说明](IMPLEMENTATION-20260922.md) 和 [41号设计](../../docs/41-Jev体验升级点集成设计.md)。上面的 9/21 实验与人工盲审保持原样；不把后续代码接入等同于旧盲审通过。
