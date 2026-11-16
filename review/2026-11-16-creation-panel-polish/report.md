# 创作面板来源菜单与提示词引用收口

日期：2026-11-16

状态：`#1134 / #1136 / #1137 / #1132` 已落地；`#1135` 按用户确认取消。

## 目标

1. 模型菜单去掉搜索；顶部保持 API / 工作流 / CLI 三个来源标签，第四枚“设置”跟随当前标签跳转。
2. 图片 / 视频切换恢复需求取消，不做代码调整。
3. 上游提示词不再占一行状态文字，改成素材条里的 TXT 图标，与上游图片同一套几何和操作。
4. 模型 chip 去掉 API / 工作流 / CLI 文字角标；普通工作流条目不重复“工作流”分组标题。

## 实现

- `SourceModelMenu`
  - 删除搜索框、搜索状态与搜索空态。
  - 顶部四项：三个来源 tab + `设置` 动作。
  - 设置动作的目标随当前 tab 变化：`channels` / `workflows` / `cli`。
  - 删除底部重复设置行与 chip 前来源角标。
- `sourceMenuModel`
  - 标签元数据从 `footer` 改为 `settings`。
  - 普通工作流分组标题留空；AI 应用分组保留。
- `panelModel` / `PanelLayer`
  - 上游提示词生成 `kind: 'prompt'` 的素材项。
  - 保留编号、小眼睛和删除连线语义。
- `CreationAssetViews` / `PromptReferenceThumb.module.css`
  - TXT 图标使用与图片缩略图相同的 52px 外层几何。
  - 点击图标发送 `focusNode`，选中提示词节点并打开它的面板。
- `CreationPromptView`
  - 删除独立的“提示词 / 已链接 N 个”状态行。
- 工程收口
  - `SkillStoreContext.tsx` 从重量级 Provider 中拆出，避免演示页 eager 加载全部内置技能正文。
  - `vite.config.ts` 限定开发依赖预构建入口，避免扫描 Tauri 构建产物和临时浏览器 profile。

## 视觉证据

目录：`review/2026-11-16-creation-panel-polish/`

- `before/`：修改前菜单截图，以及用户提供的提示词行 / TXT 参考 / 来源文字截图。
- `after/*-api-menu.png`：API 菜单无搜索，第四项为“渠道设置”。
- `after/*-workflow-menu.png`：工作流菜单无重复分组标题，第四项为“工作流设置”。
- `after/*-prompt-thumb.png`：素材条里的 TXT 图标。
- 覆盖 1440×900、1024×700 和明暗主题。

自动探针结果：

```text
workflow: headerActions=4, search=0, settings=workflows, sourceBadges=0, workflowGroup=false
api:      headerActions=4, search=0, settings=channels,  sourceBadges=0, workflowGroup=false
```

四组均 `menuOverflow=false`、`bodyOverflow=false`、`pageErrors=[]`。

## 门禁

- `npm run check`：全绿。
- `npm run build`：成功。
- 完整 vitest（4 worker）：787 文件通过 / 1 跳过；6451 用例通过 / 1 跳过。
- `G46`：36/36。
- `G110`：5/5。
- `G153`：5/5。

`G110 / G153` 原失败根因是 mock 夹具保留了 `hasToken=false` 的空 Key 分组；现在离线 mock 明确标记为已就绪并清空 Key 分组，使用隔离 shared-store 验证，不触碰真实数据。
