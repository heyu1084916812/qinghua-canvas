import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { validateGovernance } from './module-governance-lib.mjs'

const GENERIC_RESPONSIBILITY = /^(?:按目录职责拆分出的)?单一(?:生产)?模块[。.]?$/
const PLACEHOLDER_MARKERS = [
  '按目录职责拆分',
  '具体范围以源码导出与兄弟测试为准',
  '本模块声明的纯函数、类型或局部视图',
  '本模块导出符号',
  '跨模块事务 owner',
  '根文档与治理登记',
  '其他目录业务状态',
  '待补充',
]
const CSS_MODULE_PREFIX = 'CSS_MODULE:'
const CSS_CLASS_PREFIX = 'CSS_CLASS:'
const NO_EXPORT_PREFIX = 'NO_EXPORT:'
const FILE_PREFIX = 'FILE:'
const TEST_PREFIX = 'TEST:'
const SEMANTIC_FIELDS = ['responsibility', 'owns', 'doesNotOwn', 'publicApi', 'test']
const SEMANTIC_MIN_CHARS = 12
export const cliModulePath = fileURLToPath(import.meta.url)
const pathOf = (root, relative) => path.join(root, ...relative.split('/'))
const text = (value) => typeof value === 'string' ? value.trim() : ''
const isPlaceholder = (value) => PLACEHOLDER_MARKERS.some((marker) => value.includes(marker))
const isGenericResponsibility = (value) => GENERIC_RESPONSIBILITY.test(value)
const cssClassNames = (source) => new Set(
  [...source.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)].map((match) => match[1]),
)
const exportNames = (module, source) => {
  const file = ts.createSourceFile(module, source, ts.ScriptTarget.Latest, true, module.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const names = new Set()
  const add = (name) => {
    if (typeof name === 'string' && name) names.add(name)
  }
  for (const statement of file.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) add(element.name.text)
      }
      continue
    }
    if (!statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue
    if (statement.name) add(statement.name.text)
    if (statement.declarationList) {
      for (const declaration of statement.declarationList.declarations) add(declaration.name?.text)
    }
  }
  return names
}
const validateTestReference = (root, module, reference) => {
  const [file, anchor] = reference.split('#')
  if (!file.startsWith('src/') && !file.startsWith('scripts/')) return '测试证据路径无效'
  if (file.includes('..') || file.includes('\\')) return '测试证据路径无效'
  if (!fs.existsSync(pathOf(root, file))) return '测试证据不存在'
  if (reference.startsWith('scripts/') && anchor && !fs.readFileSync(pathOf(root, file), 'utf8').includes(anchor)) {
    return '测试证据锚点不存在'
  }
  if (!reference.includes(FILE_PREFIX) && !reference.includes(TEST_PREFIX)) return null
  const expected = reference.includes(FILE_PREFIX)
    ? reference.split(FILE_PREFIX)[1]?.split(/[;|]/)[0]?.trim()
    : undefined
  if (expected && !module.endsWith(expected) && !module.includes(expected)) return '测试证据未覆盖本模块'
  const testSource = fs.readFileSync(pathOf(root, file), 'utf8')
  if (reference.includes(TEST_PREFIX) && !testSource.includes(path.posix.basename(module))) return '测试证据未覆盖本模块'
  return null
}

export function validateGovernanceSemantics(root, config) {
  const errors = []
  const fail = (message) => errors.push(message)
  for (const item of config.modules ?? []) {
    const module = item?.module
    if (!module) continue
    if (!fs.existsSync(pathOf(root, module))) {
      fail(`语义登记文件不存在: ${module}`)
      continue
    }
    const responsibility = text(item.responsibility)
    if (isGenericResponsibility(responsibility) || isPlaceholder(responsibility)) {
      fail(`responsibility 是占位文案或缺少具体职责: ${module}`)
    }
    if (responsibility.length < SEMANTIC_MIN_CHARS) {
      fail(`responsibility 缺少具体职责: ${module}`)
    }
    if (!/[\u4e00-\u9fff]/.test(responsibility) && !/[A-Za-z]/.test(responsibility)) {
      fail(`responsibility 缺少具体职责: ${module}`)
    }
    for (const field of ['owns', 'doesNotOwn']) {
      const values = item[field]
      if (!Array.isArray(values) || values.length === 0) {
        fail(`${field} 缺少具体边界: ${module}`)
        continue
      }
      for (const value of values) {
        const detail = text(value)
        if (isPlaceholder(detail) || detail.length < 4) fail(`${field} 是占位文案: ${module} -> ${detail}`)
      }
      if (new Set(values.map(text)).size !== values.length) fail(`${field} 含重复边界: ${module}`)
    }
    const publicApi = item.publicApi
    if (!Array.isArray(publicApi) || publicApi.length === 0) {
      fail(`publicApi 缺少具体声明: ${module}`)
    } else {
      const source = fs.readFileSync(pathOf(root, module), 'utf8')
      for (const value of publicApi) {
        const detail = text(value)
        if (isPlaceholder(detail) || detail.length < 4) {
          fail(`publicApi 是占位文案: ${module} -> ${detail}`)
        } else if (module.endsWith('.css')) {
          if (detail.startsWith(CSS_MODULE_PREFIX)) {
            if (text(detail.slice(CSS_MODULE_PREFIX.length)).length < 6) fail(`publicApi 样式域不具体: ${module}`)
          } else if (detail.startsWith(CSS_CLASS_PREFIX)) {
            const className = detail.slice(CSS_CLASS_PREFIX.length)
            if (!cssClassNames(source).has(className)) fail(`publicApi 不是真实 CSS 类名: ${module} -> ${className}`)
          } else {
            fail(`publicApi 必须标记 CSS 样式域或真实类名: ${module} -> ${detail}`)
          }
        } else if (detail.startsWith(NO_EXPORT_PREFIX)) {
          if (text(detail.slice(NO_EXPORT_PREFIX.length)).length < 6 || exportNames(module, source).size > 0) {
            fail(`publicApi 的无导出声明与源码不符: ${module}`)
          }
        } else if (!exportNames(module, source).has(detail)) {
          fail(`publicApi 不是真实导出: ${module} -> ${detail}`)
        }
      }
      if (module.endsWith('.css') && !publicApi.some((value) => text(value).startsWith(CSS_MODULE_PREFIX))) {
        fail(`publicApi 缺少 CSS 样式域: ${module}`)
      }
      if (module.endsWith('.css') && publicApi.some((value) => text(value).startsWith(NO_EXPORT_PREFIX))) {
        fail(`publicApi 不能把 CSS 模块标成无导出: ${module}`)
      }
      if (new Set(publicApi.map(text)).size !== publicApi.length) fail(`publicApi 含重复声明: ${module}`)
    }
    const tests = item.test
    if (!Array.isArray(tests) || tests.length === 0) {
      fail(`test 缺少具体证据: ${module}`)
    } else {
      for (const reference of tests) {
        const detail = text(reference)
        if (isPlaceholder(detail)) fail(`test 是占位文案: ${module} -> ${detail}`)
        const failure = validateTestReference(root, module, detail)
        if (failure) fail(`${failure}: ${module} -> ${detail}`)
      }
    }
    for (const field of SEMANTIC_FIELDS) {
      const value = item[field]
      if (typeof value === 'string' && isPlaceholder(text(value))) fail(`${field} 是占位文案: ${module}`)
    }
  }
  return errors
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(cliModulePath)
if (isCli) {
  const root = path.resolve(import.meta.dirname, '..')
  const config = JSON.parse(fs.readFileSync(path.join(root, 'architecture/module-governance.json'), 'utf8'))
  const errors = [
    ...validateGovernance(root, config),
    ...validateGovernanceSemantics(root, config),
  ]
  if (errors.length) {
    console.error(`module governance failed (${errors.length}):\n${errors.map((error) => `- ${error}`).join('\n')}`)
    process.exitCode = 1
  } else {
    console.log(`module governance passed: ${config.legacy.length} legacy budgets; new TS/TSX <= ${config.defaults.ts}, CSS <= ${config.defaults.css}; directory coverage src/**; ${config.modules.length} semantic registrations`)
  }
}
