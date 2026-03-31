# 经验教训 — 信息中枢 v3

## 2026-03-04 JSON 字段原地修改导致状态未持久化
- 触发事件：用户反馈“链接任务创建后状态长期停在 queued，看不到真实失败阶段”。
- 根因：`summary_result` 为 JSON 字段，原地修改字典后再赋同一对象，SQLAlchemy 未稳定触发 UPDATE。
- 防错规则：对 JSON 字段更新必须“拷贝后回写新对象”，禁止依赖原地修改。
- 下次预检点：涉及 `_source_meta/_callback` 等 JSON 写入时，增加“写后读”断言校验字段确实落库。
- 证据指针：
  - `services/audio/app/tasks/audio_pipeline.py`
  - `qa/p0/test_audio_url_async_lifecycle.sh`

## 2026-03-03 Feed 与音频状态未闭环
- 触发事件：用户反馈“播客能抓取，但 Feed 看不到进度和结果，无法闭环使用”。
- 根因：`items` 表虽有 `audio_status/audio_task_id/transcript/knowledge` 字段，但缺触发入口和回调更新链路。
- 防错规则：设计里存在状态字段时，必须同时交付“触发入口 + 状态回写 + 前端可见”三件套。
- 下次预检点：联调时至少验证 1 次“Feed 一键触发 -> 音频任务 -> 回调写回 -> 前端展示”完整路径。
- 证据指针：
  - `services/hub-engine/src/routes/items.ts`
  - `services/hub-engine/src/routes/hooks.ts`
  - `services/audio/app/tasks/audio_pipeline.py`
  - `apps/web/src/pages/Feed.tsx`

## 2026-03-03 音频链接抓取失败可观测性不足
- 触发事件：用户反馈“链接能填但流程失败，且前端看不出原因”。
- 根因：下载失败错误只返回通用文本，缺少结构化失败码与来源信息，排障依赖后端日志。
- 防错规则：凡是跨网络抓取能力，API 必须返回 `failure_code + failure_detail + source_meta`。
- 下次预检点：上线前执行 3 类链接冒烟（YouTube/播客页面/直链），校验失败信息是否前端可见。
- 证据指针：
  - `services/audio/app/services/podcast_service.py`
  - `services/audio/app/api/tasks.py`
  - `apps/web/src/pages/AudioStudio.tsx`
