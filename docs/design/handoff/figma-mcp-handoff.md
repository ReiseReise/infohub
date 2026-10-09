---
title: 信息中枢 v3 Figma MCP Handoff
type: figma-mcp-handoff
status: active
version: v0.6
updated: 2026-07-03
source_device: macpro-main
---

# Figma MCP Handoff

## MCP 使用记录

- 使用官方 Figma MCP 创建 Figma design 文件。
- 使用 `use_figma` 建立文件结构、封面、Design Kit、Redesign 和 Handoff 页面。
- 使用 Playwright 访问本地页面并生成 Baseline 截图。
- 使用 Figma MCP `upload_assets` 将截图上传到 Figma。
- 使用 Figma MCP `get_screenshot` 验证关键节点可渲染。

## 文件信息

- fileKey: `nFZbnEWt6FLIHTMSNvcPCj`
- URL: https://www.figma.com/design/nFZbnEWt6FLIHTMSNvcPCj

## 关键节点

- 最新设计入口说明：`57:3`
- 现有融合精修全页面：`57:2`
- v0.6 `/login`：`57:14`
- v0.6 `/register`：`57:76`
- v0.6 `/insights`：`57:138`
- v0.6 `/feed`：`57:256`
- v0.6 `/feed/:id`：`57:388`
- v0.6 `/daily/workbench`：`57:520`
- v0.6 `/daily/workflows`：`57:638`
- v0.6 `/daily/candidates`：`57:752`
- v0.6 `/daily/reports/latest`：`57:866`
- v0.6 `/reports`：`57:946`
- v0.6 `/podcast`：`57:1026`
- v0.6 `/audio`：`57:1140`
- v0.6 `/sources`：`57:1254`
- v0.6 `/monitor`：`57:1390`
- v0.6 `/rules`：`57:1526`
- v0.6 `/filtered`：`57:1640`
- v0.6 `/export`：`57:1754`
- v0.6 `/ai-usage`：`57:1868`
- v0.6 `/reader-lab`：`57:1982`
- v0.6 `/reader-lab/setup`：`57:2096`
- v0.6 `/reader-lab/compare`：`57:2210`
- v0.6 `/settings`：`57:2324`
- 开发交接切片：`10:5`
- 设计系统：`3:4`
- 归档基线：`3:2`

当前 Figma 页面已统一中文命名，移动端页面已从当前结构移除。本轮后续开发只以 `01 最新设计｜现有融合精修 v0.6` 为主入口。`92 归档｜阅读优先全页面 v0.5（方向错误）` 不作为开发参考。

## 降级路径

如果后续 Figma MCP 不可用：

1. 仍以本目录文档和 `docs/design/screenshots/` 作为项目设计证据。
2. 用浏览器打开 Figma URL 手工查看节点。
3. 开发实现时先参考 `handoff/design-code-map.md`，再人工对照 Figma。
4. 等 MCP 恢复后再同步节点和截图验证。

## 边界

- MCP 不保存本地登录 token。
- 上传到 Figma 的 Baseline 是页面截图，不是业务数据导出。
- 任何后续实现仍需回到代码项目里按组件边界开发。
