import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { countLines, validateGovernance } from './module-governance-lib.mjs'
import { cliModulePath, validateGovernanceSemantics } from './check-module-governance.mjs'

const root = path.resolve(import.meta.dirname, '..')
const require = createRequire(import.meta.url)
const realConfig = JSON.parse(fs.readFileSync(path.join(root, 'architecture/module-governance.json'), 'utf8'))
let fixture
let baseline
let fixtureEnv
const write = (relative, source) => {
  const target = path.join(fixture, relative)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, source)
}
const registration = (overrides = {}) => ({ module: 'src/domain/newRule.ts', owner: 'domain', responsibility: '单一规则。', owns: ['规则'], doesNotOwn: ['UI'], publicApi: ['newRule'], test: ['src/domain/newRule.test.ts'], budget: 450, ...overrides })
const run = (config) => validateGovernance(fixture, config, { env: fixtureEnv })
const semanticRegistration = (overrides = {}) => ({
  module: 'src/domain/newRule.ts',
  owner: 'domain',
  responsibility: '把项目树路径归一成稳定键，生成折叠状态与删除确认提示。',
  owns: ['路径归一化', '折叠状态投影'],
  doesNotOwn: ['项目树 React 渲染', '项目仓储事务'],
  publicApi: ['newRule'],
  test: ['src/domain/newRule.test.ts'],
  budget: 450,
  ...overrides,
})
const runSemantics = (config) => validateGovernanceSemantics(fixture, config)
const config = (entries = [], overrides = {}) => ({ version: 1, baseline, defaults: { ts: 450, css: 600 }, directories: [{ path: 'src/domain', ts: 450, css: 600 }], legacy: [], modules: entries, removedModules: [], moduleMoves: [], ...overrides })

const runCli = (configObject, overrides = {}) => {
  const cliRoot = path.join(fixture, 'cli')
  fs.rmSync(cliRoot, { recursive: true, force: true })
  const pack = (relative, value) => {
    const target = path.join(cliRoot, relative)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`)
  }
  pack('src/domain/newRule.ts', 'export const newRule = true\n')
  pack('src/domain/newRule.test.ts', '')
  pack('architecture/module-governance.json', configObject)
  const typescriptEntry = pathToFileURL(require.resolve('typescript')).href
  pack('scripts/check-module-governance.mjs', fs.readFileSync(cliModulePath, 'utf8').replace(
    "from 'typescript'",
    `from ${JSON.stringify(typescriptEntry)}`,
  ))
  pack('scripts/module-governance-lib.mjs', fs.readFileSync(path.join(root, 'scripts/module-governance-lib.mjs'), 'utf8'))
  return execFileSync(process.execPath, ['scripts/check-module-governance.mjs'], {
    cwd: cliRoot,
    env: fixtureEnv,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...overrides,
  })
}

beforeAll(() => {
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'qinghua-module-governance-'))
  fixtureEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  execFileSync('git', ['init', '-q'], { cwd: fixture, env: { ...fixtureEnv, GIT_DIR: path.join(fixture, '.git'), GIT_WORK_TREE: fixture } })
  write('src/domain/existing.ts', 'export const existing = true\n')
  write('src/domain/legacyBudget.ts', 'export const one = 1\nexport const two = 2\nexport const three = 3\n')
  write('src/domain/newRule.test.ts', '')
  execFileSync('git', ['add', 'src'], { cwd: fixture, env: fixtureEnv })
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'base'], { cwd: fixture, env: fixtureEnv })
  baseline = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fixture, encoding: 'utf8', env: fixtureEnv }).trim()
})
afterAll(() => fs.rmSync(fixture, { recursive: true, force: true }))

describe('模块预算与职责登记门禁', () => {
  it('生产登记覆盖 18 个 TS/TSX 和 7 个 CSS legacy，预算不高于基线', () => {
    expect(realConfig.legacy).toHaveLength(25)
    expect(realConfig.legacy.filter((item) => /\.tsx?$/.test(item.module))).toHaveLength(18)
    expect(realConfig.legacy.filter((item) => item.module.endsWith('.css'))).toHaveLength(7)
    for (const item of realConfig.legacy) {
      const original = countLines(execFileSync('git', ['show', `${realConfig.baseline}:${item.module}`], { cwd: root, encoding: 'utf8' }))
      const current = countLines(fs.readFileSync(path.join(root, item.module), 'utf8'))
      expect(item.budget, item.module).toBeLessThanOrEqual(original)
      expect(current, item.module).toBeLessThanOrEqual(item.budget)
    }
    expect(validateGovernance(root, realConfig)).toEqual([])
  }, 60_000)
  it('目录默认预算覆盖新文件，缺失登记会红', () => {
    write('src/domain/newRule.ts', 'export const rule = true\n')
    expect(run(config())).toContain('新生产文件缺少职责登记: src/domain/newRule.ts')
    expect(run(config([registration()]))).toEqual([])
  })
  it('新文件故意超过默认预算会红，登记预算也不能高于目录上限', () => {
    write('src/domain/oversized.ts', 'export const n = 1\n'.repeat(451))
    expect(run(config([registration({ module: 'src/domain/oversized.ts' })])).some((error) => error.includes('451 > 450'))).toBe(true)
    expect(run(config([registration({ module: 'src/domain/oversized.ts', budget: 451 })]))).toContain('新模块预算高于目录上限: src/domain/oversized.ts')
    write('src/domain/oversized.ts', 'export const n = 1\n')
  })
  it('每个必填职责字段、公共 API 和测试证据都真实存在', () => {
    for (const field of ['owner', 'responsibility', 'owns', 'doesNotOwn', 'publicApi', 'test', 'budget']) {
      expect(run(config([registration({ [field]: undefined })])).some((error) => error.includes('职责登记字段无效')), field).toBe(true)
    }
    expect(run(config([registration({ test: ['src/domain/missing.test.ts'] })])).some((error) => error.includes('测试证据不存在'))).toBe(true)
  })
  it('目录预算、路径、重复登记和失效 legacy 不能绕过', () => {
    expect(run({ ...config(), defaults: { ts: 451, css: 600 } }).some((error) => error.includes('默认预算'))).toBe(true)
    expect(run(config([registration({ module: '../escape.ts' })])).some((error) => error.includes('职责登记字段无效'))).toBe(true)
    const current = config([registration(), registration({ module: 'src/domain/oversized.ts' })])
    expect(run({ ...current, modules: [...current.modules, registration()] }).some((error) => error.includes('重复职责登记'))).toBe(true)
    expect(run({ ...current, legacy: [registration({ module: 'src/domain/newRule.ts' })] }).some((error) => error.includes('legacy 不在基线'))).toBe(true)
  })
  it('生产代码不能把逻辑藏进测试或 fixtures 绕过登记与预算', () => {
    write('src/domain/fixtures/hidden.ts', 'export const hidden = true\n')
    write('src/domain/usesFixture.ts', "import { hidden } from './fixtures/hidden'\nexport { hidden }\n")
    expect(
      run(
        config([
          registration({
            module: 'src/domain/usesFixture.ts',
            publicApi: ['hidden'],
          }),
        ]),
      ).some((error) => error.includes('生产代码不得依赖测试或夹具')),
    ).toBe(true)
    fs.rmSync(path.join(fixture, 'src/domain/usesFixture.ts'))
    fs.rmSync(path.join(fixture, 'src/domain/fixtures'), {
      recursive: true,
      force: true,
    })
  })
  it('legacy 只能保持或下降，旧预算增加会红', () => {
    write('src/domain/legacyBudget.ts', 'export const one = 1\nexport const two = 2\n')
    const current = config([registration(), registration({ module: 'src/domain/oversized.ts', budget: 450 })])
    const tightened = registration({ module: 'src/domain/legacyBudget.ts', budget: 2 })
    expect(run({ ...current, legacy: [tightened] })).toEqual([])
    expect(
      run({ ...current, legacy: [{ ...tightened, budget: 4 }] }),
    ).toContain(
      'legacy 预算不得高于基线实测: src/domain/legacyBudget.ts 4 > 3',
    )
  })
  it('基线生产文件删除或改名必须进入显式台账', () => {
    const source = 'src/domain/existing.ts'
    fs.rmSync(path.join(fixture, source))
    expect(run(config([registration()])).some((error) =>
      error.includes('基线生产文件未经删除/搬家台账即消失: src/domain/existing.ts'),
    )).toBe(true)
    expect(run(config([registration()], {
      removedModules: ['src/domain/existing.ts'],
    })).some((error) => error.includes('基线生产文件未经删除/搬家台账即消失'))).toBe(false)
    write('src/domain/renamed.ts', 'export const existing = true\n')
    expect(run(config([
      registration({ module: 'src/domain/newRule.ts' }),
      registration({ module: 'src/domain/oversized.ts' }),
      registration({ module: 'src/domain/renamed.ts' }),
    ], {
      moduleMoves: [{
        from: source,
        to: 'src/domain/renamed.ts',
        reason: '改名后职责登记同步迁移',
      }],
    }))).toEqual([])
    fs.rmSync(path.join(fixture, 'src/domain/renamed.ts'))
    write(source, 'export const existing = true\n')
  })
  it('嵌套生产目录、登记失效与搬家目标缺失都会红', () => {
    const source = 'src/domain/existing.ts'
    if (!fs.existsSync(path.join(fixture, source))) write(source, 'export const existing = true\n')
    fs.rmSync(path.join(fixture, source))
    write('src/domain/nested/deep/hidden.ts', 'export const hidden = true\n')
    expect(run(config([registration()], {
      removedModules: [source],
      moduleMoves: [{
        from: source,
        to: 'src/domain/missing.ts',
        reason: '目标应存在',
      }],
    })).some((error) => error.includes('搬家目标不存在: src/domain/missing.ts'))).toBe(true)
    expect(run(config([registration()], {
      removedModules: [source],
    })).some((error) => error.includes('新生产文件缺少职责登记: src/domain/nested/deep/hidden.ts'))).toBe(true)
    expect(run(config([registration({ module: 'src/domain/deleted.ts' })], {
      removedModules: [source],
    })).some((error) => error.includes('新模块登记的文件不存在: src/domain/deleted.ts'))).toBe(true)
    fs.rmSync(path.join(fixture, 'src/domain/nested'), { recursive: true, force: true })
    write(source, 'export const existing = true\n')
  })
  }, 20_000)

describe('职责登记语义门禁', () => {
  it('语义合格的新模块通过：职责具体、公共 API 是真实导出、测试路径存在', () => {
    write('src/domain/newRule.ts', 'export const newRule = true\n')
    expect(runSemantics(config([semanticRegistration()]))).toEqual([])
  })

  it('占位 responsibility、纯套话边界与空职责都会红', () => {
    const placeholder = '按目录职责拆分出的单一生产模块；具体范围以源码导出与兄弟测试为准。'
    expect(runSemantics(config([semanticRegistration({ responsibility: placeholder })])).some((error) =>
      error.includes('responsibility 是占位文案'),
    )).toBe(true)
    expect(runSemantics(config([semanticRegistration({ responsibility: '单一生产模块。' })])).some((error) =>
      error.includes('responsibility 缺少具体职责'),
    )).toBe(true)
    expect(runSemantics(config([semanticRegistration({ owns: ['本模块声明的纯函数、类型或局部视图'] })])).some((error) =>
      error.includes('owns 是占位文案'),
    )).toBe(true)
    expect(runSemantics(config([semanticRegistration({ doesNotOwn: ['跨模块事务 owner', '根文档与治理登记', '其他目录业务状态'] })])).some((error) =>
      error.includes('doesNotOwn 是占位文案'),
    )).toBe(true)
  })

  it('publicApi 占位、虚构导出名与不存在的测试路径都会红', () => {
    expect(runSemantics(config([semanticRegistration({ publicApi: ['本模块导出符号'] })])).some((error) =>
      error.includes('publicApi 是占位文案'),
    )).toBe(true)
    expect(runSemantics(config([semanticRegistration({ publicApi: ['missingRule'] })])).some((error) =>
      error.includes('publicApi 不是真实导出'),
    )).toBe(true)
    expect(runSemantics(config([semanticRegistration({ test: ['src/domain/missing.test.ts'] })])).some((error) =>
      error.includes('测试证据不存在'),
    )).toBe(true)
  })

  it('CSS 模块可用真实样式域和类名，拒绝占位或虚构类名', () => {
    write('src/domain/newRule.module.css', '.rule { color: red; }\n.ruleOn { color: green; }\n')
    const cssRegistration = (overrides = {}) => semanticRegistration({
      module: 'src/domain/newRule.module.css',
      publicApi: ['CSS_MODULE:领域规则状态样式', 'CSS_CLASS:rule', 'CSS_CLASS:ruleOn'],
      budget: 600,
      ...overrides,
    })
    expect(runSemantics(config([cssRegistration()]))).toEqual([])
    expect(runSemantics(config([cssRegistration({ publicApi: ['本模块导出符号'] })])).some((error) =>
      error.includes('publicApi 是占位文案'),
    )).toBe(true)
    expect(runSemantics(config([cssRegistration({ publicApi: ['CSS_MODULE:领域规则状态样式', 'CSS_CLASS:notAClass'] })])).some((error) =>
      error.includes('publicApi 不是真实 CSS 类名'),
    )).toBe(true)
  })

  it('显式 no-export 模块通过；未标明的无导出 TS 模块会红', () => {
    write('src/domain/noExports.ts', 'globalThis.__moduleGovernanceProbe = true\n')
    const noExports = semanticRegistration({ module: 'src/domain/noExports.ts' })
    expect(runSemantics(config([{ ...noExports, publicApi: ['NO_EXPORT:仅注册全局领域规则副作用，不提供模块导出'] }]))).toEqual([])
    expect(runSemantics(config([noExports])).some((error) => error.includes('publicApi 不是真实导出'))).toBe(true)
  })

  it('Windows 路径下 CLI 相对路径调用也执行语义门禁，红绿结果与函数一致', () => {
    write('src/domain/newRule.ts', 'export const newRule = true\n')
    write('src/domain/noExports.ts', 'globalThis.__moduleGovernanceProbe = true\n')
    const good = config([semanticRegistration()], { baseline })
    const bad = config([semanticRegistration({ publicApi: ['本模块导出符号'] })], { baseline })
    expect(validateGovernanceSemantics(fixture, good)).toEqual([])
    expect(validateGovernanceSemantics(fixture, bad).length).toBeGreaterThan(0)
    expect(runCli(good)).toContain('module governance passed')
    let cliFailure
    try {
      runCli(bad)
    } catch (error) {
      cliFailure = error
    }
    expect(cliFailure).toBeTruthy()
    expect(cliFailure.status).toBe(1)
    expect(`${cliFailure.stdout ?? ''}${cliFailure.stderr ?? ''}`).toContain('publicApi 是占位文案')
  })
})
