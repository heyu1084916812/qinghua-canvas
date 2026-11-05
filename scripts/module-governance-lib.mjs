import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ENTRY_KEYS = ['version', 'baseline', 'defaults', 'directories', 'legacy', 'modules']
const MODULE_KEYS = ['module', 'owner', 'responsibility', 'owns', 'doesNotOwn', 'publicApi', 'test', 'budget']
const SOURCE = /\.(?:ts|tsx|css)$/
const TEST = /\.(?:test|spec)\.[^.]+$|(?:^|\/)(?:__tests__|fixtures|mocks)(?:\/|$)/
const IMPORT_TEST_ARTIFACT = /\.(?:test|spec)\.[^/]+$|(?:^|\/)(?:__tests__|fixtures|mocks)(?:\/|$)/

export const countLines = (source) => source.length === 0 ? 0 : source.split(/\r?\n/).length - (source.endsWith('\n') ? 1 : 0)
const text = (value) => typeof value === 'string' && value.trim().length > 0
const list = (value) => Array.isArray(value) && value.length > 0 && value.every(text)
const keysAreExact = (value, keys) => value && Object.keys(value).sort().join(',') === [...keys].sort().join(',')
const validPath = (value, root = 'src/') => typeof value === 'string' && value.startsWith(root) && !value.includes('\\') && !value.split('/').includes('..')
const directoryBudget = (config, module) => {
  const directory = config.directories.filter((item) => module.startsWith(`${item.path}/`)).sort((a, b) => b.path.length - a.path.length)[0]
  return directory?.[module.endsWith('.css') ? 'css' : 'ts'] ?? config.defaults[module.endsWith('.css') ? 'css' : 'ts']
}
const git = (root, args, env) => execFileSync('git', args, { cwd: root, encoding: 'utf8', env })
const baselineContents = (root, baseline, env, files) => new Map(files.map((file) => [file, git(root, ['show', `${baseline}:${file}`], env)]))
const baselineDirectories = (root, baseline, env) => new Set(git(root, ['ls-tree', '-d', '--name-only', `${baseline}:src`], env).trim().split(/\r?\n/).filter(Boolean).map((directory) => `src/${directory}`))
const walk = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)])
const pathOf = (root, relative) => path.join(root, ...relative.split('/'))
const testExists = (root, reference) => {
  if (!reference.startsWith('scripts/')) return fs.existsSync(pathOf(root, reference))
  const [file, anchor] = reference.split('#')
  return fs.existsSync(pathOf(root, file)) && (!anchor || fs.readFileSync(pathOf(root, file), 'utf8').includes(anchor))
}
const importSpecifiers = (source) =>
  [...source.matchAll(/(?:\bfrom\s+|\bimport\s*(?:\(\s*)?)['"]([^'"]+)['"]/g)].map(
    (match) => match[1],
  )

export function validateGovernance(root, config, options = {}) {
  const errors = []
  const fail = (message) => errors.push(message)
  if (!keysAreExact(config, ENTRY_KEYS) || config.version !== 1 || !text(config.baseline)) fail('登记根字段或版本无效')
  if (!keysAreExact(config.defaults, ['ts', 'css']) || config.defaults.ts > 450 || config.defaults.css > 600) fail('新模块默认预算必须不超过 TS/TSX 450、CSS 600 行')
  if (!Array.isArray(config.directories) || config.directories.length === 0) fail('目录预算不能为空')
  for (const item of config.directories ?? []) {
    if (!keysAreExact(item, ['path', 'ts', 'css']) || !validPath(item.path, 'src') || !Number.isInteger(item.ts) || !Number.isInteger(item.css) || item.ts < 1 || item.css < 1 || item.ts > config.defaults.ts || item.css > config.defaults.css || item.path === 'src') fail(`目录预算无效或高于默认上限: ${item.path}`)
  }
  const all = [...(config.legacy ?? []), ...(config.modules ?? [])]
  const entries = new Map()
  for (const item of all) {
    if (!item || !keysAreExact(item, MODULE_KEYS) || !validPath(item.module) || !SOURCE.test(item.module) || TEST.test(item.module) || !text(item.owner) || !text(item.responsibility) || !list(item.owns) || !list(item.doesNotOwn) || !list(item.publicApi) || !list(item.test) || !Number.isInteger(item.budget) || item.budget < 1) {
      fail(`职责登记字段无效: ${item?.module ?? '<unknown>'}`)
      continue
    }
    if (entries.has(item.module)) fail(`重复职责登记: ${item.module}`)
    entries.set(item.module, item)
    for (const reference of item.test) if (!validPath(reference, '') || (!reference.startsWith('src/') && !reference.startsWith('scripts/')) || !testExists(root, reference)) fail(`测试证据不存在: ${item.module} -> ${reference}`)
  }
  const baseline = new Set(git(root, ['ls-tree', '-r', '--name-only', config.baseline, '--', 'src'], options.env).trim().split(/\r?\n/).filter(Boolean))
  const knownDirectories = baselineDirectories(root, config.baseline, options.env)
  const legacyPaths = new Set()
  const baselineSources = baselineContents(root, config.baseline, options.env, (config.legacy ?? []).map((item) => item.module).filter((module) => baseline.has(module)))
  for (const item of config.legacy ?? []) {
    if (!item.module) continue
    legacyPaths.add(item.module)
    if (!fs.existsSync(pathOf(root, item.module))) fail(`legacy 文件不存在: ${item.module}`)
    if (!baseline.has(item.module)) fail(`legacy 不在基线 ${config.baseline}: ${item.module}`)
  }
  for (const item of config.modules ?? []) {
    if (!item.module) continue
    if (legacyPaths.has(item.module)) fail(`同一文件不能同时是 legacy 和新模块: ${item.module}`)
    if (item.budget > directoryBudget(config, item.module)) fail(`新模块预算高于目录上限: ${item.module}`)
  }
  const current = walk(pathOf(root, 'src')).map((file) => path.relative(root, file).split(path.sep).join('/')).filter((file) => SOURCE.test(file) && !TEST.test(file))
  for (const directory of knownDirectories) if (!config.directories.some((item) => item.path === directory)) fail(`生产目录未配置预算: ${directory}`)
  for (const directory of fs.readdirSync(pathOf(root, 'src'), { withFileTypes: true })) {
    if (directory.isDirectory() && !config.directories.some((item) => item.path === `src/${directory.name}`)) fail(`新生产目录未配置预算: src/${directory.name}`)
  }
  for (const module of current) {
    const entry = entries.get(module)
    if (!entry && !baseline.has(module)) fail(`新生产文件缺少职责登记: ${module}`)
    if (!entry) continue
    const source = fs.readFileSync(pathOf(root, module), 'utf8')
    const lines = countLines(source)
    if (lines > entry.budget) fail(`超出行数预算: ${module} ${lines} > ${entry.budget}`)
    if (legacyPaths.has(module) && baselineSources.has(module)) {
      const original = countLines(baselineSources.get(module))
      if (entry.budget > original) fail(`legacy 预算不得高于基线实测: ${module} ${entry.budget} > ${original}`)
    }
    for (const specifier of importSpecifiers(source)) {
      if (!specifier.startsWith('.')) continue
      const target = path.posix
        .normalize(path.posix.join(path.posix.dirname(module), specifier))
        .replace(/[?#].*$/, '')
      if (IMPORT_TEST_ARTIFACT.test(target)) {
        fail(`生产代码不得依赖测试或夹具: ${module} -> ${specifier}`)
      }
    }
  }
  for (const entry of config.modules ?? []) if (!fs.existsSync(pathOf(root, entry.module))) fail(`新模块登记的文件不存在: ${entry.module}`)
  const missingLegacy = current.filter((module) => countLines(fs.readFileSync(pathOf(root, module), 'utf8')) > 1000 && !legacyPaths.has(module))
  if (missingLegacy.length) fail(`超千行文件未进入 legacy 白名单: ${missingLegacy.join(', ')}`)
  return errors
}
