import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { countLines, validateGovernance } from './module-governance-lib.mjs'

const root = path.resolve(import.meta.dirname, '..')
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
const config = (entries = []) => ({ version: 1, baseline, defaults: { ts: 450, css: 600 }, directories: [{ path: 'src/domain', ts: 450, css: 600 }], legacy: [], modules: entries })

beforeAll(() => {
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'qinghua-module-governance-'))
  fixtureEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  execFileSync('git', ['init', '-q'], { cwd: fixture, env: { ...fixtureEnv, GIT_DIR: path.join(fixture, '.git'), GIT_WORK_TREE: fixture } })
  write('src/domain/existing.ts', 'export const existing = true\n')
  write('src/domain/newRule.test.ts', '')
  execFileSync('git', ['add', 'src'], { cwd: fixture, env: fixtureEnv })
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'base'], { cwd: fixture, env: fixtureEnv })
  baseline = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fixture, encoding: 'utf8', env: fixtureEnv }).trim()
})
afterAll(() => fs.rmSync(fixture, { recursive: true, force: true }))

describe('模块预算与职责登记门禁', () => {
  it('生产登记覆盖 18 个 TS/TSX 和 7 个 CSS legacy，实测等于基线', () => {
    expect(realConfig.legacy).toHaveLength(25)
    expect(realConfig.legacy.filter((item) => /\.tsx?$/.test(item.module))).toHaveLength(18)
    expect(realConfig.legacy.filter((item) => item.module.endsWith('.css'))).toHaveLength(7)
    for (const item of realConfig.legacy) {
      expect(countLines(execFileSync('git', ['show', `${realConfig.baseline}:${item.module}`], { cwd: root, encoding: 'utf8' })), item.module).toBe(item.budget)
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
    const current = config([registration(), registration({ module: 'src/domain/oversized.ts', budget: 450 })])
    const old = registration({ module: 'src/domain/existing.ts', budget: 1 })
    expect(run({ ...current, legacy: [old] })).toEqual([])
    expect(run({ ...current, legacy: [{ ...old, budget: 2 }] }).some((error) => error.includes('只许下降'))).toBe(true)
    write('src/domain/existing.ts', 'export const existing = true\nexport const smaller = true\n')
    expect(run({ ...current, legacy: [old] }).some((error) => error.includes('2 > 1'))).toBe(true)
    expect(run({ ...current, legacy: [{ ...old, budget: 2 }] }).some((error) => error.includes('只许下降'))).toBe(true)
    execFileSync('git', ['add', 'src/domain/existing.ts'], { cwd: fixture, env: fixtureEnv })
    execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'shrink legacy', '--', 'src/domain/existing.ts'], { cwd: fixture, env: fixtureEnv })
    baseline = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fixture, encoding: 'utf8', env: fixtureEnv }).trim()
    expect(countLines(execFileSync('git', ['show', `${baseline}:src/domain/existing.ts`], { cwd: fixture, encoding: 'utf8', env: fixtureEnv }))).toBe(2)
    expect(run({ ...current, baseline, legacy: [{ ...old, budget: 2 }] })).toEqual([])
  })
  }, 20_000)
