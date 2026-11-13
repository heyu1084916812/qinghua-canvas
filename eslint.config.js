import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import importPlugin from 'eslint-plugin-import'
import globals from 'globals'

/**
 * 图标统一门禁的豁免清单（轻画-图标统一方案 §4.1 / §5 / §6）。
 * `ICON_KEEP`：明确保留的图形（品牌 Logo、连线层、用户指定形状的预设），永久豁免。
 * `ICON_PENDING`：尚未迁移的文件，每迁完一批从这里删掉对应文件，清空后删除本常量。
 */
const ICON_KEEP = [
  'src/app/QinghuaWordmark.tsx',
  'src/features/settings/MemoryGraph.tsx',
  'src/features/shared/channelIcon/ChannelIcon.tsx',
  'src/features/shared/modelIcon/ModelIcon.tsx',
  'src/workbenches/canvas/flow/FlowChildEdgeLayer.tsx',
  'src/workbenches/canvas/flow/FlowCoarseEdgeLayer.tsx',
  'src/workbenches/canvas/flow/FlowDraftLayer.tsx',
  'src/workbenches/canvas/flow/FlowSnapLayer.tsx',
  'src/workbenches/canvas/icons/presetGlyph.tsx',
  'src/workbenches/canvas/panels/presetIcons.tsx',
]

const ICON_PENDING = [
  'src/app/AppSidebarIcons.tsx',
  'src/app/ProjectTreeIcons.tsx',
  'src/app/SettingsIcons.tsx',
  'src/app/TitleBar.tsx',
  'src/app/UpdateNotice.tsx',
  'src/features/shared/choicePicker/ChoicePicker.tsx',
  'src/pages/AssetsPage/AssetCard.tsx',
  'src/pages/AssetsPage/AssetPreview.tsx',
  'src/pages/CanvasPage/SkillLibraryOverlay.tsx',
  'src/pages/EcommercePage/EcommerceWorkbenchViews.tsx',
  'src/pages/EcommercePage/LongImagePanel.tsx',
  'src/pages/InspirationPage/InspirationPage.tsx',
  'src/pages/ProjectsPage/ProjectsPage.tsx',
  'src/pages/ProjectsPage/ProjectsPageViews.tsx',
  'src/pages/SettingsPage/SettingsPicker.tsx',
  'src/pages/SkillsPage/SkillLibraryIcons.tsx',
  'src/pages/StoryboardPage/StoryboardIcons.tsx',
  'src/workbenches/canvas/menu/ContextMenu.tsx',
  'src/workbenches/canvas/nodes/fusion/FusionNodeView.tsx',
  'src/workbenches/canvas/nodes/generation/GenerationNodeView.tsx',
  'src/workbenches/canvas/nodes/loop/LoopNodeView.tsx',
  'src/workbenches/canvas/panels/AgentPanel/AgentStepIcon.tsx',
  'src/workbenches/canvas/panels/AgentPanel/QuestionCardSummary.tsx',
  'src/workbenches/canvas/panels/AssetMenu.tsx',
  'src/workbenches/canvas/panels/ParamPicker.tsx',
  'src/workbenches/canvas/panels/creation/CreationRunActionsView.tsx',
  'src/workbenches/canvas/surface/Minimap.tsx',
  'src/workbenches/canvas/text/MentionEditor.tsx',
  'src/workbenches/canvas/toolbar/icons.tsx',
  'src/workbenches/ecommerce/EcommerceSelect.tsx',
  'src/workbenches/ecommerce/studio/EcommerceStudioModeParametersProduct.tsx',
  'src/workbenches/ecommerce/studio/EcommerceStudioStatusViews.tsx',
  'src/workbenches/ecommerce/studio/studioSharedViews.tsx',
]

export default tseslint.config(
  {
    /**
     * `scripts/probe-*.mjs` 是**临时验证脚本**（与 .gitignore 同口径，不入库）：
     * 用完即删，里面的变量常常只为调试而留。让 lint 扫它们只会反复报
     * 「assigned but never used」——那是脚本的常态，不是缺陷。
     * 正式脚本（scripts/smoke.mjs 等）仍照常检查。
     */
    /**
     * `public/` 是**静态资源目录**，原样搬到产物里，不经打包器也不参与业务代码规范：
     * 里面是 MediaPipe 的第三方 bundle（`vision_bundle.js`，压缩过的）与在 Worker
     * 里跑的人脸检测脚本（用 `self` / `importScripts` / `Vision` 这些 Worker 专有全局，
     * 与 `src/` 的模块环境不是一套）。让 lint 扫它们只会得到一屏无意义的 `no-undef`。
     */
    ignores: [
      'dist',
      'node_modules',
      '.workbuddy',
      '.playwright-verify',
      /**
       * `.market-research/` 是**一次性调研产物**：原样下载的第三方前端 chunk
       * （压缩过的 minified bundle）、官方 API 规格快照等。它们既不入库
       * （见 `.gitignore`）也不归本项目规范管 —— 让 lint 去解析压缩过的第三方
       * bundle 只会得到一屏 `no-undef` / `no-func-assign`，把真正的错误淹掉。
       */
      '.market-research',
      'public',
      'scripts/probe-*.mjs',
      /**
       * `src-tauri/` 是 **Rust 桌面壳**（Tauri 2）：那是另一套语言与构建链
       * （`cargo` / `tauri.conf.json`），不归 TS 的 ESLint 管 —— 不忽略会直接
       * 「Parsing error: Invalid character」（拿 JS 解析器去读 `.rs`）。
       * ⚠️ `src-tauri/target/` 另有自己的 `.gitignore`，这里只是连源码一起排除。
       */
      'src-tauri',
      'target',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // 配置文件是 CommonJS（dependency-cruiser 用 .cjs）
    files: ['*.cjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // scripts/ 下的验证脚本跑在 node 里（Playwright 驱动），但脚本内部会 evaluate 浏览器代码
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { import: importPlugin },
    languageOptions: {
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    settings: {
      'import/resolver': {
        typescript: { alwaysTryTypes: true },
      },
    },
    rules: {
      // 跨层依赖方向由 .dependency-cruiser.js 强制；这里只约束层内可读性
      'no-restricted-imports': 'off',
      // 与 tsconfig 的 noUnusedParameters 口径一致：下划线前缀表示「刻意不用的占位参数」
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  /**
   * 图标统一门禁（轻画-图标统一方案 §4.1 / §7）：
   * 业务代码不得手写 `<svg>`，一律走 `src/ui/icon` 的 `<Icon>`；
   * 也不得直接 import `lucide-react`，只从 `src/ui/icon` 取图标。
   * ⚠️ 本块必须排在下面 `src/domain/**` 的配置**之前**：flat config 里后出现的规则
   * 会整条覆盖前面的 `no-restricted-imports`，排在后面会把 domain 层「禁止 import 上层」
   * 那组约束悄悄顶掉。
   */
  {
    files: ['src/**/*.tsx'],
    ignores: ['**/*.test.tsx', 'src/ui/icon/**', ...ICON_KEEP, ...ICON_PENDING],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXOpeningElement[name.name="svg"]',
          message: '禁止手写 <svg>：改用 src/ui/icon 的 <Icon>（轻画-图标统一方案 §2）。',
        },
      ],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/domain/**', 'src/ui/icon/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['lucide-react', 'lucide-react/*'],
              message: '图标只从 src/ui/icon 取（轻画-图标统一方案 §4.1）。',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'domain 层禁止 import React' },
            { name: 'react-dom', message: 'domain 层禁止 import react-dom' },
          ],
          patterns: [
            { group: ['**/platform/**'], message: 'domain 层禁止 import platform' },
            { group: ['**/state/**'], message: 'domain 层禁止读写全局状态' },
            { group: ['**/features/**'], message: 'domain 层禁止 import features' },
            { group: ['**/workbenches/**'], message: 'domain 层禁止 import workbenches' },
            { group: ['**/ui/**'], message: 'domain 层禁止 import ui' },
            { group: ['**/pages/**', '**/app/**'], message: 'domain 层禁止 import 上层' },
          ],
        },
      ],
    },
  },
)
