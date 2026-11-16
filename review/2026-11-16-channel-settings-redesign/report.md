# 渠道设置整页重构（#1138）

## 结果

- 右栏固定为六步：渠道信息、Key 分组切换器、当前分组 Key/属性、模型列表、模型映射、当前分组测试。
- Key 分组标签只显示名称与 Key 状态点；切换分组时只渲染当前分组的一套内容。
- 模型映射归属 Key 分组。不同分组可把不同真实 ID 映射到同一前端模型，路由按“渠道 × 分组 × 前端模型 × 真实 ID”展开。
- 映射表按当前分组已选真实模型排列，三列为真实模型、对应前端模型、全局常用状态；不设固定映射状态列，不提供逐行测试。
- 渠道优先级和权重收进渠道头部；前端模型目录从顶部与映射区进入，使用弹窗管理。
- 不常用属于全局前端模型：隐藏于选择器、停止路由、保留所有分组映射。

## 证据

- 改前：`before/channel-{1440x900,1024x700}-{dark,light}.png`
- 改后：`after/channel-{1440x900,1024x700}-{dark,light}.png`
- 改前底部：`before/channel-bottom-*.png`
- 改后底部：`after/channel-bottom-*.png`
- 渠道路由属性：`after/channel-routing-*.png`
- 前端模型目录弹窗：`after/channel-model-manager-*.png`

四组目标视口均为 `horizontalOverflow=false`、`pageerror=0`；改后探针读取到当前分组 1 个、映射行 3 个、固定映射状态列 0 个。

## 关键代码

- `src/domain/project/channel.ts`：Key 分组映射字段。
- `src/state/project/channelRepository.ts`：老渠道映射迁移，渠道级聚合兼容。
- `src/state/channel/channelStore.ts`：分组映射绑定与不常用路由门禁。
- `src/domain/project/modelRouting.ts`、`routePlan.ts`、`generationRouting.ts`：分组级真实 ID 候选。
- `src/pages/SettingsPage/settingsPage/SettingsKeyGroupView.tsx`：分组切换器与当前分组属性。
- `src/pages/SettingsPage/settingsPage/SettingsChannelRouteView.tsx`：源优先映射表与前端模型目录弹窗。

## 验证

- 定向 Vitest：30 文件 / 325 用例通过。
- 完整 Vitest：787 文件通过 / 1 跳过；6459 用例通过 / 1 跳过。
- `npm run check`：全段通过（类型、ESLint、依赖、模块治理、版本、主题、对比度、壳层几何、文档与账本门禁）。
- `npm run build`：通过（Vite 仅保留既有大 chunk 提示与 PostCSS `from` 警告）。
