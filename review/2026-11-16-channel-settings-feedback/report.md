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

## #1140 分类分组与常用开关

- 模型映射按 `生图 / 对话 / 视频 / 配音` 分组，分类标题显示组内数量。
- 模型行保持“图标 + 名称”；重复的小分类字移除。
- 常用状态改为明确的开关：`role="switch"`、`aria-checked`、开/关轨道与滑块。
- 标记不常用后默认隐藏该行，映射保留；勾选“显示不常用模型”后恢复，开关显示关闭。
- 样式拆分到 `SettingsModelCategory.module.css`，没有抬高原映射模块行长预算。

证据：`after-v3-category/mapping-{1440x900,1024x700}-{dark,light}.png` 与 `after-v3-category/report.json`。四组均为 `horizontalOverflow=false`、`errors=[]`；交互记录 `hidden=true` 且恢复后 `aria-checked=false`。关键冒烟 `g74 45/45`、`g83 4/4`，完整关键矩阵 `g8/g44/g45/g74 99/99`。
## #1141 模型映射分类过滤

- 分类从纵向堆叠改为 `role="tablist"` 切换器，默认选中首个可用分类；选中“生图”时只渲染 `data-route-map-category="image"` 的行，不再同时显示对话、视频或配音。
- 支持鼠标点击、左右方向键、Home / End 切换；分类按钮保留模型数量，并通过 `aria-controls` 关联同一个 `tabpanel`。
- 选中态使用 `--bg-surface + --stroke-focus`，悬停使用 `--bg-hover`，焦点环使用 `--focus-ring`，与设置页既有标签规范一致。
- 证据：`after-v4-category-filter/mapping-{1440x900,1024x700}-{dark,light}.png`、`mapping-section-*.png` 与 `report.json`。
- 四组实测默认仅显示 `image`；切到“对话”仅显示 `chat`；键盘下一档仅显示 `audio`；`horizontalOverflow=false`、`errors=[]`。定向冒烟 `g74 48/48`、`g83 4/4`。

## #1142 渠道字段与快速测试 UI 收口

- 渠道优先级和权重移到渠道名称与齿轮右侧的同一行，删除“仅影响不同渠道之间的竞争”说明；特殊协议的 RunningHub 站点说明仍按原逻辑保留，只隐藏 `openai-compatible` 的通用长说明。
- 地址、协议、API Key、保存按钮和快速测试选择器统一为 34px 高；协议选择器与地址框等高。
- 快速测试的原生 `<select>` 换成项目 `ChoicePicker`，使用项目下拉菜单、10px 控制圆角和蓝色焦点环；右侧箭头保持 13px 内边距，运行按钮与选择器等高。
- 移除 API Key 下方重复的“已保存”状态行，输入框占位仍显示已保存令牌尾号。
- 改前证据：`before-v5-polish/{header,connection,quick-test}-*.png`；改后证据：`after-v5-polish/{header,connection,quick-test,quick-test-menu-viewport}-*.png` 与 `report.json`。
- 四组实测：名称/优先级/权重中心同轴；地址、协议、选择器、运行按钮均 `34px`；箭头右侧 `13px`；焦点环 `2px`；下拉菜单圆角 `10px`；无原生 select、无通用协议长说明、无重复“已保存”；`errors=[]`、无横向溢出。
- 浏览器门禁：`g74 52/52`、`g45 12/12`、`g83 4/4`；全量 `npm test` 为 787 文件通过 / 1 跳过、6460 用例通过 / 1 跳过；`npm run check`、`npm run build`、Impeccable detector 均通过。
