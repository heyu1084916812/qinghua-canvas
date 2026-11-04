import { describe, expect, it } from 'vitest'

/**
 * AgentPanel 的结构护栏。
 *
 * 只读源码、只做断言，不改任何实现。目的只有一个：**拆分成果不许回弹**。
 * - 行数棘轮：`AgentPanel.tsx` 只能变小，想调高阈值请先拆分。
 * - 下沉模块不许带 React 状态：`.ts` 里出现 hook 调用说明它其实是个组件/Hook。
 * - 不许反向依赖：下沉模块不能反过来 import 面板本体。
 * - 每个下沉模块都要有兄弟测试。
 */

/**
 * `AgentPanel.tsx` 的行数上限。
 *
 * **每完成一刀就下调，只许降不许升。** 需要上调的话，答案永远是「继续拆」，
 * 不是「把阈值调大」。
 *
 * 调节奏：按「该刀实测 + 40」定值，之后每刀同理——阈值始终贴着实测走，留出的 40 行
 * 只够接一刀，不够养回一个胖文件。当前 1874 = #897 初始加载控制器拆出后实测 1834 + 40。
 */
const AGENT_PANEL_MAX_LINES = 1874

/**
 * `.ts` 下沉模块里允许出现的 hook 调用（模块名 → 理由）。
 *
 * 正常应当是空的：真的需要 React 状态就写成 `useAgent*.ts` 控制器。
 * 加例外必须写清楚理由，否则护栏就变成了装饰。
 */
const REACT_STATE_EXCEPTIONS: Readonly<Record<string, string>> = {}

/**
 * 纯类型模块（模块名 → 为什么不需要兄弟测试）。
 *
 * 这些文件只有 `import type` / `export interface` / `export type`，**没有任何运行时导出**，
 * 测无可测。既然不需要测试，就必须反过来钉住「它真的还是纯类型」——往里面加一个
 * `export function` 或值导入，下面的断言会当场红，逼你把逻辑挪进有测试的模块。
 */
const TYPE_ONLY_MODULES: Readonly<Record<string, string>> = {
  'agentChatRoute.ts':
    '只有 import type / interface / type alias，无运行时导出，测无可测',
}

/**
 * `import.meta.glob` 只接受字面量模式（Vite 在编译期展开），所以这里必须逐个写死，
 * 不能抽成 `readRaw(pattern)` 之类的辅助函数。
 */
const PANEL_SOURCE = (
  import.meta.glob('./AgentPanel.tsx', {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>
)['./AgentPanel.tsx']
const AGENT_MODULES = import.meta.glob('./agent*.ts', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>
const CONTROLLER_MODULES = import.meta.glob('./useAgent*.ts', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

const NAME_ONLY = (path: string): string => path.replace(/^.*\//, '')

/**
 * 行数口径（与文档一致）：`source.split('\n')`，文件以换行结尾时减 1
 * —— 否则那个收尾换行会被 split 算成一个多余的空行。
 */
const countLines = (source: string): number => {
  const parts = source.split('\n').length
  return source.endsWith('\n') ? parts - 1 : parts
}

const isTestFile = (path: string): boolean => path.endsWith('.test.ts')

const HOOK_CALL =
  /\b(?:useState|useEffect|useCallback|useMemo|useRef)\s*\(/

/** 只匹配指向面板本体的相对导入（`./AgentPanel`、`./AgentPanelView`、带 `.tsx` 也行）。 */
const PANEL_REVERSE_IMPORT =
  /['"]\.\/AgentPanel(?:View)?(?:\.tsx)?['"]/

const moduleNames = (): string[] =>
  [...Object.keys(AGENT_MODULES), ...Object.keys(CONTROLLER_MODULES)]
    .filter((path) => !isTestFile(path))
    .map(NAME_ONLY)
    .sort()

/** 去掉块注释与行注释。类型模块里没有别的地方会出现这两个记号，够用。 */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')

/**
 * 切顶层语句：只在**深度 0** 的 `;` 处、或「深度 0 换行后紧跟 import/export（或文件结束）」处断开。
 *
 * 括号与引号内部不断，所以 `| { ok: false; message: string }` 这种联合体不会被劈成两条。
 * 只服务 `TYPE_ONLY_MODULES` 这种极窄输入，不做通用 TS 解析。
 */
const topLevelStatements = (source: string): string[] => {
  const out: string[] = []
  let current = ''
  let depth = 0
  let quote: string | null = null
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (quote) {
      current += char
      if (char === '\\') {
        current += source[index + 1] ?? ''
        index += 1
        continue
      }
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      current += char
      continue
    }
    if (char === '{' || char === '(' || char === '[') depth += 1
    else if (char === '}' || char === ')' || char === ']') depth -= 1
    if (depth === 0 && char === ';') {
      if (current.trim()) out.push(current.trim())
      current = ''
      continue
    }
    if (depth === 0 && char === '\n') {
      const rest = source.slice(index + 1).replace(/^\s+/, '')
      if (rest === '' || /^(?:import|export)\b/.test(rest)) {
        if (current.trim()) out.push(current.trim())
        current = ''
        continue
      }
    }
    current += char
  }
  if (current.trim()) out.push(current.trim())
  return out
}

/** 纯类型模块里唯一合法的三种顶层语句。 */
const TYPE_ONLY_STATEMENT =
  /^(?:import\s+type\b|export\s+interface\b|export\s+type\b)/

/** 返回某文件里**不属于**上述三种形态的顶层语句（即运行时语句）。 */
const runtimeStatementsOf = (source: string): string[] =>
  topLevelStatements(stripComments(source)).filter(
    (statement) => !TYPE_ONLY_STATEMENT.test(statement),
  )

const moduleSources = (): Map<string, string> =>
  new Map(
    Object.entries(AGENT_MODULES)
      .filter(([path]) => !isTestFile(path))
      .map(([path, source]) => [NAME_ONLY(path), source]),
  )

describe('AgentPanel 结构护栏', () => {
  it('行数口径自检：收尾换行不算一行', () => {
    // 度量本身也要被钉住，否则「口径写错」会让棘轮悄悄失效。
    expect(countLines('a')).toBe(1)
    expect(countLines('a\n')).toBe(1)
    expect(countLines('a\nb\n')).toBe(2)
    expect(countLines('a\nb')).toBe(2)
  })

  it(`AgentPanel.tsx 不超过 ${AGENT_PANEL_MAX_LINES} 行`, () => {
    expect(PANEL_SOURCE, '没读到 AgentPanel.tsx 原文').toBeTypeOf('string')
    const lines = countLines(PANEL_SOURCE)
    const over = lines - AGENT_PANEL_MAX_LINES
    if (over > 0) {
      throw new Error(
        `AgentPanel 超预算 ${over} 行：拆分后请把阈值调回实际值 + 40 的余量，别调上去放水`,
      )
    }
    expect(lines).toBeLessThanOrEqual(AGENT_PANEL_MAX_LINES)
  })

  it('下沉模块清单不是空的（glob 没读到文件时上面几条会假绿）', () => {
    expect(Object.keys(AGENT_MODULES).length).toBeGreaterThan(10)
    expect(Object.keys(CONTROLLER_MODULES).length).toBeGreaterThan(5)
    // 钉一个已知模块，确认读到的确实是本目录的真实源码。
    expect(moduleNames()).toContain('agentToolExecution.ts')
  })

  it('规则正则自检：认得真实写法，也不误伤近似名', () => {
    expect(HOOK_CALL.test('const [open, setOpen] = useState(false)')).toBe(true)
    expect(HOOK_CALL.test('const value = useMemo(() => 1, [])')).toBe(true)
    expect(HOOK_CALL.test('const state = useStateLater(1)')).toBe(false)

    expect(PANEL_REVERSE_IMPORT.test("import { x } from './AgentPanel'")).toBe(
      true,
    )
    expect(
      PANEL_REVERSE_IMPORT.test("import { x } from './AgentPanelView'"),
    ).toBe(true)
    expect(
      PANEL_REVERSE_IMPORT.test("import { x } from './AgentPanelView.tsx'"),
    ).toBe(true)
    expect(
      PANEL_REVERSE_IMPORT.test("import { x } from './agentPanelShutdown'"),
    ).toBe(false)
  })

  it('所有 agent*.ts 都不带 React 状态', () => {
    const offenders = Object.entries(AGENT_MODULES)
      .filter(([path]) => !isTestFile(path))
      .filter(([, source]) => HOOK_CALL.test(source))
      .map(([path]) => NAME_ONLY(path))
      .filter((name) => !(name in REACT_STATE_EXCEPTIONS))

    expect(offenders).toEqual([])
  })

  it('所有 agent*.ts 都不反向 import 面板本体', () => {
    const offenders = Object.entries(AGENT_MODULES)
      .filter(([path]) => !isTestFile(path))
      .filter(([, source]) => PANEL_REVERSE_IMPORT.test(source))
      .map(([path]) => NAME_ONLY(path))

    expect(offenders).toEqual([])
  })

  it('每个下沉模块都有同名兄弟测试（纯类型模块除外）', () => {
    const existing = new Set(
      [...Object.keys(AGENT_MODULES), ...Object.keys(CONTROLLER_MODULES)]
        .map(NAME_ONLY)
        .filter(isTestFile),
    )
    const missing = moduleNames().filter(
      (name) =>
        !(name in TYPE_ONLY_MODULES) &&
        !existing.has(`${name.replace(/\.ts$/, '')}.test.ts`),
    )

    expect(missing).toEqual([])
  })

  it('纯类型模块确实只有类型语句，没有运行时导出', () => {
    const sources = moduleSources()
    const offenders = Object.entries(TYPE_ONLY_MODULES)
      .map(([name]) => ({
        name,
        source: sources.get(name),
      }))
      .filter((item) => {
        expect(item.source, `${item.name} 不在 agent*.ts 清单里`).toBeTypeOf(
          'string',
        )
        return runtimeStatementsOf(item.source ?? '').length > 0
      })
      .map(
        (item) =>
          `${item.name}：${runtimeStatementsOf(item.source ?? '')[0].slice(0, 60)}`,
      )

    expect(offenders).toEqual([])
  })

  it('纯类型模块扫描器自检：放行三种类型语句，抓得到运行时语句', () => {
    const legitimate = [
      "import type { DirectRunRouteCandidate } from '../../../../state/shared/directRun'",
      'export interface AgentChatRoute extends RoutedChatTarget {\n  routePlanId: string\n  candidates: DirectRunRouteCandidate[]\n}',
      'export type ChatRoutePreparation =\n  | { ok: true; route: AgentChatRoute }\n  | { ok: false; message: string }',
    ].join('\n\n')
    expect(runtimeStatementsOf(legitimate)).toEqual([])

    expect(runtimeStatementsOf('export const value = 1')).toHaveLength(1)
    expect(runtimeStatementsOf("import { A } from './a'")).toHaveLength(1)
    expect(
      runtimeStatementsOf('export function build(): number {\n  return 1\n}'),
    ).toHaveLength(1)
    // 类型语句后面偷偷追加一条运行时语句也要被抓到。
    expect(
      runtimeStatementsOf(
        'export interface X {\n  a: string\n}\nexport const b = 2',
      ),
    ).toHaveLength(1)
    // 注释里提到 hook 不算违规。
    expect(
      runtimeStatementsOf('// 这里曾经有个 useState(\nexport type A = string'),
    ).toEqual([])
  })

  it('纯类型模块清单本身有效：文件存在、理由非空', () => {
    const known = new Set(moduleNames())
    expect(
      Object.keys(TYPE_ONLY_MODULES).filter((name) => !known.has(name)),
    ).toEqual([])
    expect(
      Object.values(TYPE_ONLY_MODULES).every(
        (reason) => reason.trim().length > 0,
      ),
    ).toBe(true)
  })
})

/** 从 `openIndex` 处的括号开始，取到配对的闭括号（跳过字符串内部）。 */
const balancedFrom = (source: string, openIndex: number): string => {
  const open = source[openIndex]
  const close = open === '(' ? ')' : open === '{' ? '}' : ']'
  let depth = 0
  let quote: string | null = null
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index]
    if (quote) {
      if (char === '\\') {
        index += 1
        continue
      }
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      continue
    }
    if (char === open) depth += 1
    else if (char === close) {
      depth -= 1
      if (depth === 0) return source.slice(openIndex, index + 1)
    }
  }
  return ''
}

/** 取出 `createXxx(...)` 这次调用的完整参数文本；找不到就返回空串。 */
const callBlock = (source: string, anchor: string): string => {
  const at = source.indexOf(anchor)
  if (at < 0) return ''
  const open = source.indexOf('(', at + anchor.length - 1)
  return open < 0 ? '' : balancedFrom(source, open)
}

/**
 * toolCtx 的三条「调用即取」铁律。
 *
 * 这个回调是「发消息时创建、用户点批准才执行」的：任何一项变成渲染时快照，
 * 执行时就会拿旧值 —— 轻则选错节点（`selectedIds` / `selectedModelOf`），
 * 重则停止按钮关不掉正在跑的生成（`signal`）并继续扣费。
 */
describe('toolCtx 的调用即取闭包', () => {
  it('signal 端口是 thunk：每次调用才读 abortRefs', () => {
    const block = callBlock(PANEL_SOURCE, 'createAgentToolResearch(')
    expect(block, '没找到 createAgentToolResearch(...)').not.toBe('')
    // 必须是 `signal: () => abortRefs.current…`
    expect(block).toMatch(/signal:\s*\(\)\s*=>/)
    expect(block).toContain('abortRefs.current.get(sessionId)')
    // 值形态一律不许：`signal: abortRefs.current…`
    expect(block).not.toMatch(/signal:\s*abortRefs\./)
    // 也不许在创建前先算好再传进来
    expect(PANEL_SOURCE).not.toMatch(
      /const\s+\w*[Ss]ignal\w*\s*=\s*abortRefs\.current/,
    )
  })

  it('perImage 每次建上下文都读 sessionRuntime.current（条件键在组装层展开）', () => {
    // 面板侧：建 ctx 时现读 ref，不许提前算成组件级常量
    expect(PANEL_SOURCE).toMatch(
      /perImage:\s*sessionRuntimeRef\.current\.isPerImage\(\s*sessionId\s*\)/,
    )
    expect(PANEL_SOURCE).not.toMatch(
      /const\s+\w+\s*=\s*sessionRuntimeRef\.current\.isPerImage\(/,
    )
    // 组装层：只有真值才**出键**（`perImage: false` 会把键带出来）
    const composer = AGENT_MODULES['./agentToolContext.ts']
    expect(composer, '没找到 agentToolContext.ts').toBeTruthy()
    expect(composer).toMatch(
      /base\.perImage\s*\?\s*\{\s*perImage:\s*true\s*\}\s*:\s*\{\}/,
    )
    expect(composer).not.toMatch(/perImage:\s*base\.perImage\b/)
  })

  it('selectedIds / selectedModelOf 保持函数与同一引用，不能变快照', () => {
    const composer = AGENT_MODULES['./agentToolContext.ts']
    expect(composer, '没找到 agentToolContext.ts').toBeTruthy()
    // 组装层：selectedIds 必须是函数（读建 ctx 时那份 selection）
    expect(composer).toContain('selectedIds: () => base.selection')
    // selectedModelOf 原样透传（同一引用，不包新箭头）
    expect(composer).toMatch(
      /^\s*selectedModelOf: base\.selectedModelOf,\s*$/m,
    )
    // 面板侧：只传快照与引用，不许包成值
    expect(PANEL_SOURCE).toMatch(/^\s*selectedModelOf,\s*$/m)
    expect(PANEL_SOURCE).not.toMatch(/selectedIds:\s*selection\b/)
    expect(PANEL_SOURCE).not.toMatch(/const\s+selectedIds\s*=\s*selection/)
    expect(composer).not.toMatch(/selectedIds:\s*base\.selection\b/)
  })

  it('runNodes 的素材在调用时才读 contextTrace，不许提前算成常量', () => {
    // 读 ref 的那一下必须在 thunk 里（`() => contextTraceRef.current…`），
    // 这样「跑节点」执行时才拿得到那一刻的素材（管它是内联还是经端口传下去）。
    expect(PANEL_SOURCE).toMatch(
      /\(\)\s*=>\s*contextTraceRef\.current\.get\(sessionId\)\?\.assetRefs/,
    )
    expect(PANEL_SOURCE).not.toMatch(
      /const\s+\w+\s*=\s*contextTraceRef\.current\.get\(sessionId\)\?\.assetRefs/,
    )
  })

  it('图片素材规则只有一份定义，并且真的被某个下沉模块用上', () => {
    const users = Object.entries(AGENT_MODULES)
      .filter(([path]) => !isTestFile(path))
      .filter(([, source]) => source.includes('imageContextAssets('))
      .map(([path]) => NAME_ONLY(path))
      .filter((name) => name !== 'agentToolContextAssets.ts')

    expect(users.length).toBeGreaterThan(0)
    // 定义处只能有一个：别在别的地方再手写一遍 startsWith('image/')
    const handRolled = Object.entries(AGENT_MODULES)
      .filter(([path]) => !isTestFile(path))
      .filter(
        ([path, source]) =>
          NAME_ONLY(path) !== 'agentToolContextAssets.ts' &&
          source.includes("startsWith('image/')"),
      )
      .map(([path]) => NAME_ONLY(path))
    expect(handRolled).toEqual([])
  })

  it('三份装配都在 toolCtx 函数体内，而不是组件级', () => {
    const start = PANEL_SOURCE.indexOf('const toolCtx = useCallback(')
    const end = PANEL_SOURCE.indexOf('const toolExecution = useMemo(')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    for (const anchor of [
      'createAgentToolResearch(',
      'createAgentToolDefaults(',
    ]) {
      const at = PANEL_SOURCE.indexOf(anchor)
      expect(at, `${anchor} 不在文件里`).toBeGreaterThan(start)
      expect(at, `${anchor} 不在 toolCtx 里`).toBeLessThan(end)
    }
  })
})

/**
 * 初始加载的孤儿清理端口接线（面板 → 控制器 → 模块）。
 *
 * ⚠️ 这是**源码级**快照，不是行为验证：真正「失败会不会提示」由
 * `agentInitialLoad.test.ts`（模块层）与 `useAgentInitialLoadController.test.ts`
 * （控制器层，端口计数）证明；这里只防「端口被删 / 又加回一条内联 warn」这种静默回退。
 */
describe('初始加载孤儿清理的接线快照', () => {
  const controller = () => {
    const source = CONTROLLER_MODULES['./useAgentInitialLoadController.ts']
    expect(source, '没找到 useAgentInitialLoadController.ts').toBeTruthy()
    return source ?? ''
  }

  it('控制器把两个端口接进 runAgentInitialLoad：提示走 error，日志带 sessionId', () => {
    const source = controller()
    expect(source).toContain(
      "notifyCleanupFailure: (message) => input.notify(message, 'error')",
    )
    expect(source).toMatch(
      /logCleanupFailure:\s*\(\{\s*sessionId,\s*attempts,\s*error\s*\}\)\s*=>\s*input\.logWarning\(\s*'\[agent\] initial session cleanup failed',\s*\{\s*sessionId,\s*attempts,\s*error:\s*errText\(error\),?\s*\},?\s*\)/,
    )
  })

  it('面板把控制器要的两个出口接到 store.notify(error) 与 platform.logger(warn)', () => {
    expect(PANEL_SOURCE).toContain(
      "notify: (message, tone) => store.notify(message, tone ?? 'error'),",
    )
    expect(PANEL_SOURCE).toContain(
      "logWarning: (message, detail) => platform.logger.log('warn', message, detail),",
    )
  })

  it('不再有内联 warn：清理失败只经端口收口，不会记两条日志', () => {
    expect(PANEL_SOURCE).not.toContain('outcome.cleanupError')
    const occurrences =
      `${PANEL_SOURCE}\n${controller()}`.match(
        /\[agent\] initial session cleanup failed/g,
      ) ?? []
    expect(occurrences).toHaveLength(1)
  })
})
