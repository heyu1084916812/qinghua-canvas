import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
/*
 * 直接 import package.json 而不是 `readFileSync`：项目的 tsconfig **刻意不装 @types/node**
 * （`types: ["vite/client"]`），而 `resolveJsonModule` 是开着的 —— JSON 导入既能拿到版本，
 * 又不用把 node 类型引进构建配置。
 */
import pkg from './package.json' with { type: 'json' }

/**
 * 应用版本（构建时注入 `__APP_VERSION__`）。
 *
 * 为什么现在才要它：扩展包（#386）带 `minAppVersion` —— 包说"需要 0.2.0 以上"时，
 * 界面必须能如实回答"当前是多少"。写死一份常量迟早与 package.json 漂移，
 * 所以从唯一来源读。
 */
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 1420,
    watch: {
      ignored: ['**/.probe-tmp/**', '**/.playwright-verify/**'],
    },
  },
  build: {
    // 生产构建剔除 dev/ 陈列室：入口不引用即被 tree-shake，这里再显式排除源码
    sourcemap: false,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    /*
     * 覆盖率只统计 AgentPanel 目录：那是这次重构的战场，也是回归最容易发生的地方。
     * 报告落到 `.playwright-verify/`（已被忽略），**不在仓库根产生 `coverage/`**。
     * 阈值是**地板不是目标**：用来挡住"改回去"，不是逼着刷数字。
     */
    coverage: {
      provider: 'v8',
      include: ['src/workbenches/canvas/panels/AgentPanel/**/*.{ts,tsx}'],
      exclude: ['**/*.test.*'],
      reporter: ['text-summary'],
      reportsDirectory: '.playwright-verify/coverage',
      /*
       * 地板值。2026-11-04 补完队列删改 / 确认预览 / 停止后不发请求三处后实测：
       * 语句 65.5% / 分支 55.8% / 函数 60.9% / 行 67.3%。
       * 每次抬阈值都必须先有行为断言垫着：**阈值只挡回退，不逼刷分**。
       */
      thresholds: {
        statements: 63,
        branches: 54,
        functions: 59,
        lines: 65,
      },
    },
  },
})
