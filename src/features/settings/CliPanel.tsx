import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePlatform } from '../../app/providers/PlatformProvider'
import {
  buildArgs,
  capabilityLabel,
  capabilitiesOfTool,
  clampToolTimeout,
  defaultCliTools,
  parseArgs,
  type CliTool,
} from '../../domain/shared/cliTools'
import { cliWindowRequest } from './cliWindowRequest'
import type { CliOutcome, CliWindowHandle } from '../../platform/ports'
import { createId } from '../../shared/id'
import { createCliToolStore } from '../../state/project/cliToolStore'
import {
  primaryCliAction,
  probeSummary,
  runDiagnosticLabel,
  type CliProbe,
} from './cliPanelPresentation'
import { cliKeyLoginResult } from './cliKeyLoginResult'
import { cliWindowFollowUp, type CliWindowFlow } from './cliWindowFollowUp'
import styles from './CliPanel.module.css'

/**
 * 「全局设置 → CLI」面板（用户 2026-10-06 第 11 批第 4 条 + 第 13 批第 2 条）。
 *
 * ## 用户口径
 *
 * - 第 11 批：「CLI 可以单独设置在全局设置里面了，就在渠道配置的下面…我的要求和目的就是
 *   链接后能用里面的额度调用模型生成图片或者视频，或者对话，runninghub 也要，需要真的能跑本机的 cli」；
 * - 第 13 批：「codex 的 cli 我想要读取到额度，即梦的我想要读取到积分，我试了一下测试 gemini
 *   和即梦都不行，runninghub 也不行，是我还需要什么嘛？」＋「如果查不了额度，我如何显示额度，
 *   我要解决这个问题，还有我如何使用的问题，我不太懂怎么设置这个 cli，
 *   我希望是我一键设置，然后输入密码或者其他的就可以保持登录」。
 *
 * ## 于是每一张卡按"用户会问的顺序"排
 *
 * 0. **一键设置**（第 14 批第 3 条：「cli 的那我做成一键安装并且登录不就行了吗？」）——
 *    一个按钮把"装 + 登录"串起来：没装就开一个安装窗口，装好了就开登录窗口。
 *    每一步都**如实说**它这一刻在做什么；窗口关闭后自动继续，不要求回来补点；
 * 1. **装没装**（检测）—— 没装就直接告诉他怎么装（`installHint`），能自动装的给「一键安装」；
 * 2. **登录**——「一键登录」在可见窗口里跑它自己的登录命令（浏览器授权 / 输密码都行），
 *    或用密钥登录（密钥走 stdin，不进 argv、不落我们的库）；
 * 3. **查状态 / 额度**——能查就把工具的原话贴出来（含 stderr：很多 CLI 把有效信息打在那儿）；
 *    查不到就直说，并写明去哪儿看（`quotaWhere`）——绝不编一个余额数字；
 * 4. **高级**（默认折起）——命令名 / 参数模板 / 超时 / 各条命令，以及"测试运行"。
 *
 * 浏览器里没有子进程：整块照旧显示（用户要的"桌面专属也要看得见"），
 * 但按钮禁用并写明"只在桌面应用里可用"，不假装能跑。
 */
export function CliPanel() {
  const platform = usePlatform()
  const cli = platform.cli
  const store = useMemo(() => createCliToolStore(platform.storage), [platform.storage])

  const [tools, setTools] = useState<CliTool[]>(() => defaultCliTools())
  const [probes, setProbes] = useState<Record<string, CliProbe>>({})
  const [runs, setRuns] = useState<Record<string, string>>({})
  const [statusOut, setStatusOut] = useState<Record<string, string>>({})
  const [loginMsg, setLoginMsg] = useState<Record<string, string>>({})
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [moreOpen, setMoreOpen] = useState<Record<string, boolean>>({})
  const [confirmRun, setConfirmRun] = useState<Record<string, boolean>>({})
  const [activeRun, setActiveRun] = useState<{
    id: string
    toolId: string
    slot: 'run' | 'status'
  } | null>(null)
  const activeRunRef = useRef<{ id: string } | null>(null)
  const [stopping, setStopping] = useState(false)
  /** 正在跑的那件小事（`<toolId>:<action>`）；空串 = 空闲 */
  const [busy, setBusy] = useState('')
  const busyRef = useRef('')
  const updateBusy = useCallback((next: string) => {
    busyRef.current = next
    setBusy(next)
  }, [])

  const probeTool = useCallback(
    async (tool: CliTool): Promise<CliProbe> => {
      if (!cli) {
        const unavailable = { kind: 'unavailable' as const, detail: '仅桌面应用可用' }
        setProbes((prev) => ({ ...prev, [tool.id]: unavailable }))
        return unavailable
      }
      setProbes((prev) => ({
        ...prev,
        [tool.id]: { kind: 'checking', detail: `正在检测「${tool.program}」…` },
      }))
      try {
        const found = await cli.which(tool.program)
        const next: CliProbe = found
          ? { kind: 'found', detail: `已找到：${found}` }
          : { kind: 'missing', detail: `未找到命令「${tool.program}」` }
        setProbes((prev) => ({ ...prev, [tool.id]: next }))
        return next
      } catch (error) {
        const next: CliProbe = {
          kind: 'error',
          detail: `检测失败：${String(error)}`,
        }
        setProbes((prev) => ({ ...prev, [tool.id]: next }))
        return next
      }
    },
    [cli],
  )

  useEffect(() => {
    let alive = true
    void store.load().then((loaded) => {
      if (!alive) return
      setTools(loaded)
      if (cli) {
        void Promise.all(loaded.map((tool) => probeTool(tool)))
      } else {
        setProbes(
          Object.fromEntries(
            loaded.map((tool) => [
              tool.id,
              { kind: 'unavailable' as const, detail: '仅桌面应用可用' },
            ]),
          ),
        )
      }
    })
    return () => {
      alive = false
    }
  }, [cli, probeTool, store])

  useEffect(
    () => () => {
      const running = activeRunRef.current
      if (running && cli) void cli.kill(running.id)
    },
    [cli],
  )

  /** 改一个字段：先改内存、再写库（反过来的话打字会等一次异步落库、一顿一顿） */
  const patchTool = (id: string, patch: Partial<CliTool>) => {
    const next = tools.map((tool) => (tool.id === id ? { ...tool, ...patch } : tool))
    setTools(next)
    if ('program' in patch) {
      setProbes((prev) => {
        const copy = { ...prev }
        delete copy[id]
        return copy
      })
    }
    void store.save(next)
  }

  const detect = async (tool: CliTool) => {
    if (!cli || busyRef.current) return
    updateBusy(`${tool.id}:which`)
    try {
      await probeTool(tool)
    } finally {
      updateBusy('')
    }
  }

  /** 跑一条命令并把输出原样写进指定槽位（测试运行 / 查状态 共用） */
  const runInto = async (tool: CliTool, slot: 'run' | 'status', args: string[], stdin?: string) => {
    if (!cli || busyRef.current) return
    const id = createId(`cli-${slot}-${tool.id}`)
    const head = `$ ${tool.program} ${args.join(' ')}`
    const write = (text: string) => {
      const setter = slot === 'status' ? setStatusOut : setRuns
      setter((prev) => ({ ...prev, [tool.id]: text }))
    }
    updateBusy(`${tool.id}:${slot}`)
    setStopping(false)
    activeRunRef.current = { id }
    setActiveRun({ id, toolId: tool.id, slot })
    write(`${head}\n…正在跑`)
    try {
      const out = await cli.run({
        id,
        program: tool.program,
        args,
        ...(tool.cwd.trim() ? { cwd: tool.cwd.trim() } : {}),
        ...(stdin === undefined ? {} : { stdin }),
        timeoutMs: tool.timeoutMs,
      })
      write(describeRun(head, out))
    } catch (err) {
      write(`${head}\n跑不起来：${String(err)}`)
    } finally {
      if (activeRunRef.current?.id === id) activeRunRef.current = null
      setStopping(false)
      setActiveRun(null)
      updateBusy('')
    }
  }

  const stopRun = async () => {
    if (!cli || !activeRun || stopping) return
    setStopping(true)
    try {
      const stopped = await cli.kill(activeRun.id)
      if (!stopped) {
        const setter = activeRun.slot === 'status' ? setStatusOut : setRuns
        setter((prev) => ({
          ...prev,
          [activeRun.toolId]: `${prev[activeRun.toolId] ?? ''}\n进程已经结束，无需再停止。`.trim(),
        }))
      }
    } catch (error) {
      const setter = activeRun.slot === 'status' ? setStatusOut : setRuns
      setter((prev) => ({
        ...prev,
        [activeRun.toolId]: `${prev[activeRun.toolId] ?? ''}\n停止失败：${String(error)}`.trim(),
      }))
      setStopping(false)
    }
  }

  function guideKeyLogin(tool: CliTool, lead = '已经装好了') {
    setMoreOpen((prev) => ({ ...prev, [tool.id]: true }))
    setLoginMsg((prev) => ({
      ...prev,
      [tool.id]:
        tool.keyLoginKind === 'config'
          ? `${lead} → 把 API Key 粘到下面那一格，点「用密钥登录」就完成登录（写进它自己的配置，之后一直是登录态）。`
          : `${lead} → 把密钥粘到下面那一格，点「用密钥登录」（通过 stdin 交给这条命令，不进入命令行参数，也不写入轻画数据库）。`,
    }))
  }

  async function spawnLoginWindow(tool: CliTool) {
    if (!cli) return
    const args = tool.loginArgs.trim() ? buildArgs(tool.loginArgs, {}) : []
    const handle = await cli.spawnWindow(cliWindowRequest(tool, tool.program, args))
    setLoginMsg((prev) => ({
      ...prev,
      [tool.id]: `已经打开登录窗口「${[tool.program, ...args].join(' ')}」；窗口关闭后会自动继续，不需要再点。`,
    }))
    watchWindow(tool, 'login', handle)
  }

  function watchWindow(tool: CliTool, flow: CliWindowFlow, handle: CliWindowHandle) {
    void handle
      .wait()
      .then(async (exitCode) => {
        const port = cli
        if (!port) return
        let found: boolean | null = null
        if (flow !== 'login') {
          const path = await port.which(tool.program)
          found = path !== null
          setProbes((prev) => ({
            ...prev,
            [tool.id]: found
              ? { kind: 'found', detail: `已找到：${path}` }
              : { kind: 'missing', detail: `未找到命令「${tool.program}」` },
          }))
        }
        const followUp = cliWindowFollowUp(flow, tool, found, exitCode)
        setLoginMsg((prev) => ({ ...prev, [tool.id]: followUp.message }))
        if (followUp.action === 'login') {
          if (tool.keyLoginKind === 'config' || tool.keyLoginKind === 'stdin') {
            guideKeyLogin(tool, '安装完成后')
          } else {
            await spawnLoginWindow(tool)
          }
        } else if (followUp.action === 'status' && followUp.statusArgs) {
          await runInto(tool, 'status', followUp.statusArgs)
        }
      })
      .catch((err) => {
        setLoginMsg((prev) => ({
          ...prev,
          [tool.id]: `等待窗口结束失败：${String(err)}`,
        }))
      })
  }

  /** 一键登录：把它自己的登录命令丢进一个可见窗口，用户在那边完成 */
  const openLogin = async (tool: CliTool) => {
    if (!cli || busyRef.current) return
    updateBusy(`${tool.id}:login`)
    try {
      await spawnLoginWindow(tool)
    } catch (err) {
      setLoginMsg((prev) => ({ ...prev, [tool.id]: `打不开登录窗口：${String(err)}` }))
    } finally {
      updateBusy('')
    }
  }

  /**
   * **一键设置**：检测 → 没装先开安装窗口 → 安装窗口结束自动重检 → 继续登录。
   * 不再要求用户回面板手点第二次。
   */
  const oneClickSetup = async (tool: CliTool) => {
    if (!cli || busyRef.current) return
    updateBusy(`${tool.id}:setup`)
    const say = (text: string) => setLoginMsg((prev) => ({ ...prev, [tool.id]: text }))
    try {
      const found = await cli.which(tool.program)
      setProbes((prev) => ({
        ...prev,
        [tool.id]: found
          ? { kind: 'found', detail: `已找到：${found}` }
          : { kind: 'missing', detail: `未找到命令「${tool.program}」` },
      }))
      if (!found) {
        const cmd = parseArgs(tool.installCommand.trim())
        if (cmd.length === 0) {
          setMoreOpen((prev) => ({ ...prev, [tool.id]: true }))
          say(`本机没有「${tool.program}」，而这个工具没有能自动装的官方途径 —— ${tool.installHint}`)
          return
        }
        const handle = await cli.spawnWindow(cliWindowRequest(tool, cmd[0], cmd.slice(1)))
        say(`已经打开安装窗口跑「${tool.installCommand}」；窗口关闭后会自动重新检测并继续，不需要再点。`)
        watchWindow(tool, 'install', handle)
        return
      }
      if (tool.keyLoginKind === 'config' || tool.keyLoginKind === 'stdin') {
        guideKeyLogin(tool)
        return
      }
      await spawnLoginWindow(tool)
    } catch (err) {
      say(`一键设置没走通：${String(err)}`)
    } finally {
      updateBusy('')
    }
  }

  /** 只装：窗口结束后自动重新检测，不再要求用户回来点。 */
  const installOnly = async (tool: CliTool) => {
    if (!cli || busyRef.current) return
    const cmd = parseArgs(tool.installCommand.trim())
    if (cmd.length === 0) return
    updateBusy(`${tool.id}:install`)
    try {
      const handle = await cli.spawnWindow(cliWindowRequest(tool, cmd[0], cmd.slice(1)))
      setLoginMsg((prev) => ({
        ...prev,
        [tool.id]: `已经打开安装窗口跑「${tool.installCommand}」；窗口关闭后会自动重新检测。`,
      }))
      watchWindow(tool, 'installOnly', handle)
    } catch (err) {
      setLoginMsg((prev) => ({ ...prev, [tool.id]: `打不开安装窗口：${String(err)}` }))
    } finally {
      updateBusy('')
    }
  }

  /**
   * 用密钥登录。两条落点（见 `CliTool.keyLoginKind`）：
   *
   * - `'stdin'`：把密钥喂给那条命令的 stdin（不进 argv、不进日志、用完即清）；
   * - `'config'`：**由壳写该工具自己的配置文件**（RunningHub 那条路的落点）——
   *   官方 CLI 的 `rh auth set-key <KEY>` 要位置参数，而本机约定是"密钥不进 argv"，
   *   所以壳直接写它认的 `%APPDATA%\rh\config.toml`，写完**当场用「查状态」验一次**
   *   （用户 2026-10-08 第 3 条要的是"按钮的功能要确实要生效"）。
   */
  const loginWithKey = async (tool: CliTool) => {
    const secret = (keys[tool.id] ?? '').trim()
    if (!cli || busyRef.current || !secret) return

    if (tool.keyLoginKind === 'config') {
      if (!cli.rhSetApiKey) return
      updateBusy(`${tool.id}:key`)
      let written = ''
      let autoStatusArgs: string[] | null = null
      try {
        written = await cli.rhSetApiKey(secret)
        setKeys((prev) => ({ ...prev, [tool.id]: '' }))
        const completion = cliKeyLoginResult(tool, written)
        autoStatusArgs = completion.statusArgs
        setLoginMsg((prev) => ({
          ...prev,
          [tool.id]: completion.message,
        }))
      } catch (err) {
        setLoginMsg((prev) => ({ ...prev, [tool.id]: `写配置失败：${String(err)}` }))
      } finally {
        updateBusy('')
      }
      /* `runInto` 自带 busy 门，所以这一句必须等上面释放了再调 */
      if (written && autoStatusArgs) await runInto(tool, 'status', autoStatusArgs)
      return
    }

    const args = buildArgs(tool.keyLoginArgs, {})
    setKeys((prev) => ({ ...prev, [tool.id]: '' }))
    await runInto(tool, 'status', args, `${secret}\n`)
  }

  const hasLocalCli = cli !== undefined

  return (
    <div className={styles.panel} data-cli-panel data-settings-panel>
      {/*
        用户 2026-10-08 第 3 条：「cli 面板那边的介绍内容太多了，用户是不会去看的，
        反而影响排版，不需要文字介绍，只需要按钮」。
        于是这一段**只剩标题 + 一句"只在桌面应用可用"的状态说明**（那是状态，不是介绍）：
        原来的两段导语（"这里配的是你本机装着的命令行工具…" / "每张卡的顺序就是你要做的事…"）
        与每张卡的 `note` 全部删掉 —— 每一步该做什么已经写在按钮上。
      */}
      {!hasLocalCli && (
        <p className={styles.notice} data-cli-desktop-only>
          本机 CLI 只在桌面应用里可用。配置仍可保存，换到桌面版后生效。
        </p>
      )}

      {tools.map((tool) => (
        <section className={styles.card} key={tool.id} data-cli-tool={tool.id}>
          <header className={styles.cardHead}>
            {/*
              原来这里有一行小字（`tool.note`）介绍这个工具是什么 —— 用户 2026-10-08：
              「不需要文字介绍，只需要按钮」。文字改成**悬停提示**：信息还在，
              但不再占版面（卡片上只剩名称 / 能力小标 / 文档链接 / 按钮）。
            */}
            <h3 className={styles.cardName} title={tool.note}>
              {tool.name}
            </h3>
            <span className={styles.caps}>
              {capabilitiesOfTool(tool).map((cap) => (
                <span className={styles.cap} key={cap}>
                  {capabilityLabel(cap)}
                </span>
              ))}
            </span>
            <span className={styles.probeChip} data-cli-probe-state={tool.id}>
              {probes[tool.id]?.kind === 'found'
                ? '已安装'
                : probes[tool.id]?.kind === 'missing'
                  ? '未安装'
                  : probes[tool.id]?.kind === 'unavailable'
                    ? '桌面专属'
                  : probes[tool.id]?.kind === 'error'
                    ? '检测失败'
                    : '检测中'}
            </span>
            {tool.docUrl && (
              <a className={styles.link} href={tool.docUrl} target="_blank" rel="noreferrer">
                文档
              </a>
            )}
          </header>
          {/*
            主操作**只留一行**（用户 2026-10-09：「cli 这个地方里面的 ui 很乱，排版层级都不太清晰，
            小文字介绍太多」）：装 + 登录是一条路（一键设置），检测与查状态是两条"看现在怎么样"，
            三个按钮一行摆完 —— 其余动作全部收进下面两个折叠区。
          */}
          <div className={styles.row}>
            <button
              type="button"
              className={`${styles.btn} ${styles.primary}`}
              data-cli-setup={tool.id}
              disabled={
                !hasLocalCli ||
                busy !== '' ||
                primaryCliAction(tool, probes[tool.id]).kind === 'checking'
              }
              onClick={() => {
                const action = primaryCliAction(tool, probes[tool.id])
                if (action.opensDetails) {
                  setMoreOpen((prev) => ({ ...prev, [tool.id]: true }))
                }
                void oneClickSetup(tool)
              }}
            >
              {primaryCliAction(tool, probes[tool.id]).label}
            </button>
            {tool.statusArgs.trim() !== '' && (
              <button
                type="button"
                className={styles.btn}
                data-cli-status={tool.id}
                disabled={!hasLocalCli || busy !== ''}
                onClick={() => void runInto(tool, 'status', buildArgs(tool.statusArgs, {}))}
              >
                查询状态
              </button>
            )}
            {activeRun?.toolId === tool.id && activeRun.slot === 'status' ? (
              <button
                type="button"
                className={styles.btn}
                data-cli-stop={tool.id}
                disabled={stopping}
                onClick={() => void stopRun()}
              >
                {stopping ? '停止中…' : '停止'}
              </button>
            ) : null}
          </div>

          {/* 结果行：检测 / 登录 / 状态的结果都贴在按钮下面（没有就不占位） */}
          {probes[tool.id] && (
            <p className={styles.result} data-cli-probe={tool.id}>
              {probeSummary(probes[tool.id])}
            </p>
          )}
          {probes[tool.id]?.kind === 'missing' && (
            <p className={styles.hint} data-cli-install-hint={tool.id}>
              {tool.installHint}
            </p>
          )}

          {loginMsg[tool.id] && (
            <p className={styles.result} data-cli-login-msg={tool.id}>
              {loginMsg[tool.id]}
            </p>
          )}
          {statusOut[tool.id] && (
            <pre className={styles.output} data-cli-statusout={tool.id}>
              {statusOut[tool.id]}
            </pre>
          )}

          {/*
            折叠区一：**更多操作**（单独安装 / 换一种登录方式 / 额度去哪看）。

            一键设置通常就够了，这些是"它没成"时的备选；收起来之后每张卡版面上
            只剩三个按钮 + 结果行（用户 2026-10-09 要的"层级清晰、别堆小字"）。

            ⚠️ `data-cli-login-box` / `-login-hint` / `-install` / `-key` / `-quota-where`
            这些锚点**换了位置但一个没删**：冒烟按它们数"每条路在不在"
            （收起的内容 `textContent` 照样读得到，见 G89）。
          */}
          <details
            className={styles.more}
            data-cli-login-box={tool.id}
            open={moreOpen[tool.id] === true}
            onToggle={(event) => {
              const open = event.target instanceof HTMLDetailsElement && event.target.open
              setMoreOpen((prev) => ({ ...prev, [tool.id]: open }))
            }}
          >
            <summary className={styles.summary}>更多操作</summary>
            <div className={styles.moreBody}>
              <div className={styles.row}>
                <button
                  type="button"
                  className={styles.btn}
                  data-cli-detect={tool.id}
                  disabled={!hasLocalCli || busy !== ''}
                  onClick={() => void detect(tool)}
                >
                  重新检测
                </button>
              </div>
              {tool.installCommand.trim() !== '' && (
                <div className={styles.row}>
                  <button
                    type="button"
                    className={styles.btn}
                    data-cli-install={tool.id}
                    disabled={!hasLocalCli || busy !== ''}
                    onClick={() => void installOnly(tool)}
                  >
                    一键安装（打开窗口）
                  </button>
                </div>
              )}
              <p className={styles.loginHint} data-cli-login-hint={tool.id}>
                {tool.loginHint}
              </p>
              <div className={styles.row}>
                {/*
                  「打开窗口登录」只对**真有交互式登录**的工具摆出来。

                  用户 2026-10-08 第 3 条：「按钮的功能要确实要生效」——
                  RunningHub 的官方 CLI 没有登录子命令（`rh` 不带参数只打印帮助），
                  它的登录只能靠写配置文件（`keyLoginKind === 'config'`），
                  所以这里**不给一个按下去只会弹帮助的按钮**。
                */}
                {(tool.loginArgs.trim() !== '' || tool.keyLoginKind !== 'config') && (
                  <button
                    type="button"
                    className={tool.keyLoginKind === 'config' ? styles.btn : `${styles.btn} ${styles.primary}`}
                    data-cli-login={tool.id}
                    disabled={!hasLocalCli || busy !== ''}
                    onClick={() => void openLogin(tool)}
                  >
                    一键登录（打开窗口）
                  </button>
                )}
                {/* 密钥登录那一格：`stdin` 与 `config` 两种落点都要摆出输入框（见 `loginWithKey`） */}
                {tool.keyLoginKind !== '' && (
                  <>
                    <input
                      className={styles.input}
                      type="password"
                      placeholder={
                        tool.keyLoginKind === 'config'
                          ? '粘贴 API Key（写进这个工具自己的配置）'
                          : '粘贴密钥（走 stdin，不落库）'
                      }
                      data-cli-key={tool.id}
                      value={keys[tool.id] ?? ''}
                      onChange={(e) => setKeys((prev) => ({ ...prev, [tool.id]: e.target.value }))}
                    />
                    <button
                      type="button"
                      className={
                        tool.keyLoginKind === 'config' ? `${styles.btn} ${styles.primary}` : styles.btn
                      }
                      data-cli-key-login={tool.id}
                      disabled={!hasLocalCli || busy !== '' || !(keys[tool.id] ?? '').trim()}
                      onClick={() => void loginWithKey(tool)}
                    >
                      用密钥登录
                    </button>
                  </>
                )}
              </div>
              <p className={styles.hint} data-cli-quota-where={tool.id}>
                {tool.quotaWhere}
              </p>
            </div>
          </details>

          {/* ④ 高级 */}
          <details className={styles.advanced} data-cli-advanced={tool.id}>
            <summary className={styles.summary}>高级设置</summary>
            <div className={styles.grid}>
              <label className={styles.field}>
                <span className={styles.label}>命令名或完整路径</span>
                <input
                  className={styles.input}
                  data-cli-program={tool.id}
                  value={tool.program}
                  spellCheck={false}
                  onChange={(e) => patchTool(tool.id, { program: e.target.value })}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>超时（秒）</span>
                <input
                  className={styles.input}
                  type="number"
                  min={1}
                  max={1800}
                  data-cli-timeout={tool.id}
                  value={Math.round(tool.timeoutMs / 1000)}
                  onChange={(e) =>
                    patchTool(tool.id, {
                      timeoutMs: clampToolTimeout(Number(e.target.value) * 1000, tool.timeoutMs),
                    })
                  }
                />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>工作目录（可选）</span>
                <input
                  className={styles.input}
                  data-cli-cwd={tool.id}
                  value={tool.cwd}
                  placeholder="例如 E:\项目\当前工作区"
                  spellCheck={false}
                  onChange={(e) => patchTool(tool.id, { cwd: e.target.value })}
                />
              </label>
            </div>
            <label className={styles.field}>
              <span className={styles.label}>参数模板（生成 / 对话用）</span>
              <input
                className={styles.input}
                data-cli-args={tool.id}
                value={tool.argsTemplate}
                spellCheck={false}
                onChange={(e) => patchTool(tool.id, { argsTemplate: e.target.value })}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>查状态命令（留空 = 这个工具没有）</span>
              <input
                className={styles.input}
                data-cli-status-args={tool.id}
                value={tool.statusArgs}
                spellCheck={false}
                onChange={(e) => patchTool(tool.id, { statusArgs: e.target.value })}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>登录窗口命令（留空 = 直接运行它自己）</span>
              <input
                className={styles.input}
                data-cli-login-args={tool.id}
                value={tool.loginArgs}
                spellCheck={false}
                onChange={(e) => patchTool(tool.id, { loginArgs: e.target.value })}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>密钥登录命令（留空 = 不支持密钥登录）</span>
              <input
                className={styles.input}
                data-cli-key-args={tool.id}
                value={tool.keyLoginArgs}
                spellCheck={false}
                onChange={(e) => patchTool(tool.id, { keyLoginArgs: e.target.value })}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>安装命令（留空 = 没有能自动装的途径）</span>
              <input
                className={styles.input}
                data-cli-install-args={tool.id}
                placeholder="例如 npm install -g 包名"
                value={tool.installCommand}
                spellCheck={false}
                onChange={(e) => patchTool(tool.id, { installCommand: e.target.value })}
              />
            </label>
            <div className={styles.actions}>
              <button
                type="button"
                className={
                  confirmRun[tool.id]
                    ? `${styles.btn} ${styles.confirmDanger}`
                    : styles.btn
                }
                data-cli-run={tool.id}
                disabled={!hasLocalCli || busy !== ''}
                onClick={() => {
                  if (!confirmRun[tool.id]) {
                    setConfirmRun((prev) => ({ ...prev, [tool.id]: true }))
                    return
                  }
                  setConfirmRun((prev) => ({ ...prev, [tool.id]: false }))
                  void runInto(
                    tool,
                    'run',
                    buildArgs(tool.argsTemplate, { prompt: TEST_PROMPT }),
                  )
                }}
              >
                {runDiagnosticLabel(confirmRun[tool.id] === true)}
              </button>
              {activeRun?.toolId === tool.id && activeRun.slot === 'run' ? (
                <button
                  type="button"
                  className={styles.btn}
                  data-cli-stop={tool.id}
                  disabled={stopping}
                  onClick={() => void stopRun()}
                >
                  {stopping ? '停止中…' : '停止运行'}
                </button>
              ) : null}
              <p className={styles.hint}>
                诊断会执行当前参数模板，可能调用真实模型并产生费用。
              </p>
            </div>
            {runs[tool.id] && (
              <pre className={styles.output} data-cli-runout={tool.id}>
                {runs[tool.id]}
              </pre>
            )}
          </details>
        </section>
      ))}
    </div>
  )
}

/** 「测试运行」喂给 `{prompt}` 的那句话 */
const TEST_PROMPT = '用一句话介绍你自己'
/** 输出贴回来的上限：CLI 可能吐几百行，界面只留尾部 */
const OUTPUT_TAIL = 2_000

function tail(text: string): string {
  return text.length <= OUTPUT_TAIL
    ? text
    : `…（前 ${text.length - OUTPUT_TAIL} 字已省略）\n${text.slice(-OUTPUT_TAIL)}`
}

function describeOutcome(out: CliOutcome): string {
  if (out.cancelled) return `已取消 · ${out.ms}ms`
  if (out.timedOut) return `超时（${out.ms}ms）：已经掐掉它`
  if (out.code === 0) return `退出码 0（成功）· ${out.ms}ms`
  return `退出码 ${out.code ?? '（系统没给）'} · ${out.ms}ms`
}

/**
 * 一次运行的结果块。
 *
 * `stderr` 单独一段：很多 CLI 把**有效信息**（例如 `codex login status` 的
 * 「Logged in using an API key - ***」）打在 stderr 上 —— 只看 stdout 会误判成"什么都没输出"。
 */
function describeRun(head: string, out: CliOutcome): string {
  return [
    head,
    describeOutcome(out),
    out.stdout.trim() ? `— 输出 —\n${tail(out.stdout)}` : '',
    out.stderr.trim() ? `— stderr —\n${tail(out.stderr)}` : '',
    !out.stdout.trim() && !out.stderr.trim() ? '（没有任何输出）' : '',
  ]
    .filter(Boolean)
    .join('\n')
}
