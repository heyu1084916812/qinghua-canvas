# 渠道设置反馈修复（#1139）

## 结果

- 模型映射以前端显示模型为行，真实模型在右侧下拉选择。
- 映射列表只展示当前 Key 分组真实模型分类可用的前端模型；无可用真实模型时不再铺满全局目录。
- “常用 / 不常用”切换即时生效：默认列表移除该行，勾选“显示不常用模型”后恢复，映射本身保留。
- API Key 输入框、眼睛按钮、保存按钮、官网取令牌入口四段分离，不覆盖。
- AI 应用和工作流入口仅在 RunningHub 渠道出现。
- 渠道优先级/权重常驻显示，多余齿轮入口已删除。
- 设置页顶部重复的“管理前端模型”已删除。
- 悬停统一使用 `--bg-hover`，控件圆角统一使用全局半径令牌，不引入字面量颜色。

## 证据

- `after-v2/channel-key-1440x900-{dark,light}.png`
- `after-v2/channel-key-1024x700-{dark,light}.png`
- `after-v2/channel-mapping-1440x900-{dark,light}.png`
- `after-v2/channel-mapping-1024x700-{dark,light}.png`
- `after-v2/report.json`

四组视口均记录 `horizontalOverflow=false`、`errors=[]`。输入端四段分离检查全部为 `true`；可见方按钮圆角集合为 `["10px"]`；不常用隐藏与恢复均为 `true`；工作流入口只出现在国内站 / 国际站 RunningHub。

## 验证

- Vitest：787 文件通过 / 1 跳过；6460 用例通过 / 1 跳过。
- 关键 Chromium 冒烟：g8 / g44 / g45 / g74 四组 97/97 通过。
- `npm run check`：通过。
- `npm run build`：通过（保留既有 PostCSS `from` 与大 chunk 提示）。
