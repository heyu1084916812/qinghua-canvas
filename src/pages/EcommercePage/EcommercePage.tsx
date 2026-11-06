import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { usePlatform } from '../../app/providers/PlatformProvider'
import { useChannels } from '../../app/providers/ChannelStoreProvider'
import {
  EcommerceExecutionProvider,
  useEcommerceExecution,
} from '../../workbenches/ecommerce/execution/EcommerceExecutionProvider'
import { useAssetMeta } from '../../features/shared/assets/index'
import { EcommerceStudio, type EcommerceResultItem, type EcommerceUpload } from '../../workbenches/ecommerce/EcommerceStudio'
import { createAgentSessionStore } from '../../state/agent/sessionStore'
import { openGlobalSettings } from '../../state/ui/globalSettings'
import {
  resolveRoutedChatTarget,
} from '../../domain/shared/chatTarget'
import {
  type EcommercePlanSession,
} from '../../domain/ecommerce/sessions'
import { LongImagePanel, type LongImageTileSource } from './LongImagePanel'
import { createProjectRepository } from '../../state/project/repository'
import { importEcommerceAsset } from '../../features/ecommerce/importEcommerceAsset'
import type { EcommerceIntentDraft } from '../../domain/ecommerce/chatParse'
import {
  capabilityOfLogical,
  logicalNames,
  panelModelOptions,
} from '../../domain/project/modelCatalog'
import { projectRoute } from '../../domain/shared/workbench'
import { downloadAsset } from '../../features/shared/assets/downloadAsset'
import { describeError } from '../../shared/result'
import { createPackStore } from '../../state/project/packStore'
import { loadEcommerceDraft, saveEcommerceDraft } from '../../state/project/ecommerceDraft'
import { createEcommerceTaskRepository } from '../../state/project/ecommerceTaskRepository'
import { createAssetLibraryRepository } from '../../state/project/assetLibraryRepository'
import { createEcommerceCanvasRepository } from '../../state/project/ecommerceCanvasRepository'
import type { EcommerceCanvasItem } from '../../domain/ecommerce/canvasItem'
import type { EcommerceFormDraft } from '../../domain/ecommerce/draft'
import type { EcommerceResultRecord, EcommerceTaskRecord } from '../../domain/ecommerce/tasks'
import {
  ECOMMERCE_PLATFORMS,
  type EcommercePlatform,
} from '../../domain/ecommerce/platforms'
import {
  ECOMMERCE_LANGUAGES,
  type EcommerceLanguage,
} from '../../domain/ecommerce/types'
import { rememberActiveWorkbench } from '../../state/project/activeCanvas'
import type { RunRecord } from '../../domain/shared/execution/runRecord'
import { createRunLogRepository } from '../../state/shared/runLogRepository'
import {
  EcommerceWorkbench,
} from './EcommerceWorkbench'
import type { EcommerceRequest } from '../../domain/ecommerce/types'
import type { EcommerceGenerationStage } from '../../domain/ecommerce/progress'
import {
  ECOMMERCE_UPSCALE_OPTIONS,
} from '../../domain/ecommerce/upscale'
import styles from './EcommercePage.module.css'

import {
  ecommerceBatchId,
  legacyAssetHashesOfNode,
  type LegacyGenerationNode,
} from './ecommercePageSupport'
import { loadEcommerceInitialTask, projectEcommerceCanvasItemDiff, refreshEcommerceWorkbench } from './ecommercePage/pageDataCoordinator'
import {
  generationStageOfTerminalResults,
  imageParamOptionsByModel as imageParamOptionsOfModels,
  longImageTilesOf,
  projectEcommerceResults,
} from './ecommercePage/pageResultProjection'
import { workbenchActionOf } from './ecommercePage/pageActionCoordinator'
import {
  createPageResultActionCoordinator,
  createResultLibraryActions,
  downloadAllResults,
  retryFailedResults,
} from './ecommercePage/pageResultActionCoordinator'
import { createPagePlanningActionCoordinator } from './ecommercePage/pagePlanningActionCoordinator'
import { createPageGenerationActionCoordinator } from './ecommercePage/pageGenerationActionCoordinator'
import {
  createEcommercePageDraftActionCoordinator,
  type EcommerceDraftUploadProjection,
} from './ecommercePage/pageDraftActionCoordinator'

/**
 * 电商工作台页（对账 #384 的 D3/D4/D5/D6）。
 *
 * ## 它是**装配层**，不是工作台
 *
 * 工作台自己的界面在 `workbenches/ecommerce/EcommerceStudio`，它**只认 props**、
 * 不认识画布；而这里负责把两侧接起来：建/取画布 store、挂执行 Provider、
 * 上传素材、建生成节点、跑引擎、把结果读回来。这样 `workbenches/ecommerce`
 * 与 `workbenches/canvas` 之间**零互引**（架构 §7.2 那条"工作台之间不互引"的口径）。
 *
 * ## A 版的数据落在哪
 *
 * 复用电商的**画布图**：产品图 / 参考图 = 素材节点，出图 = 生成节点 + 运行记录，
 * 结果字节仍是内容寻址的 `assets`。用户界面将电商与无限画布保持隔离：
 * 电商结果只能在工作台里下载、收藏或继续 AI 编辑，不从功能面板跳到画布。
 */

export function EcommercePage() {
  const { projectId } = useParams<{ projectId?: string }>()
  if (!projectId) return <EcommerceEmpty />
  return <EcommerceProject key={projectId} projectId={projectId} />
}

/** 没有项目时的引导页：给出口，不空白（D3 的验收判据之一） */
function EcommerceEmpty() {
  const platform = usePlatform()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const create = async () => {
    setBusy(true)
    setError('')
    try {
      const repo = createProjectRepository(platform.storage)
      const project = await repo.create({ name: '电商出图', workbench: 'ecommerce' })
      navigate(projectRoute('ecommerce', project.id))
    } catch {
      setError('新建项目失败，稍后再试')
      setBusy(false)
    }
  }

  return (
    <div className={styles.emptyWrap} data-ecommerce-empty-page>
      <h1 className={styles.emptyTitle}>电商工作台</h1>
      <p className={styles.emptyText}>
        上传产品图、选平台与用途，右边直接出图。任务与结果都留在这个电商工作台，
        不会和无限画布项目混在一起。
      </p>
      <button
        type="button"
        className={styles.primary}
        disabled={busy}
        data-ecommerce-create
        onClick={() => void create()}
      >
        {busy ? '正在新建…' : '新建电商项目'}
      </button>
      {error ? <p className={styles.error}>{error}</p> : null}
      <p className={styles.emptyHint}>
        也可以从「项目」页新建 —— 新建菜单里选「电商工作台」。
      </p>
    </div>
  )
}

function EcommerceProject({ projectId }: { projectId: string }) {
  const platform = usePlatform()
  useEffect(() => {
    rememberActiveWorkbench('ecommerce', projectId)
  }, [projectId])
  const [hydrated, setHydrated] = useState(false)
  const [hydrateError, setHydrateError] = useState('')
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        await platform.storage.open()
        if (cancelled) return
        setHydrated(true)
      } catch (e) {
        if (!cancelled) {
          setHydrateError(e instanceof Error ? e.message : String(e))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [platform])

  if (!hydrated) {
    return (
      <div className={styles.emptyWrap} data-ecommerce-hydrating>
        <p className={styles.emptyText}>
          {hydrateError ? `项目读取失败：${hydrateError}` : '正在读取这个电商项目…'}
        </p>
      </div>
    )
  }

  return (
    <EcommerceExecutionProvider projectId={projectId}>
      <StudioHost projectId={projectId} />
    </EcommerceExecutionProvider>
  )
}

/** 结果缩略图：按 hash 取素材（hook 必须落在子组件里，不能在 map 里调） */
function ResultPreview({ hash, mime }: { hash: string; mime?: string }) {
  const meta = useAssetMeta(hash)
  if (!meta.url) return null
  if ((mime ?? meta.mime)?.startsWith('video/')) {
    return <video src={meta.url} controls loop playsInline preload="metadata" />
  }
  return <img src={meta.url} alt="" />
}

function restoredUploadsOf(
  uploads: readonly EcommerceDraftUploadProjection[],
): EcommerceUpload[] {
  return uploads.map(({ nodeId, hash }) => ({ nodeId, hash, preview: <ResultPreview hash={hash} /> }))
}

function StudioHost({ projectId }: { projectId: string }) {
  const platform = usePlatform()
  const channels = useChannels()
  const exec = useEcommerceExecution()
  const [legacyNodes, setLegacyNodes] = useState<LegacyGenerationNode[]>([])
  useEffect(() => {
    let cancelled = false
    void platform.storage
      .query('nodes', { projectId })
      .then((rows) => {
        if (!cancelled) {
          setLegacyNodes(rows as unknown as LegacyGenerationNode[])
        }
      })
      .catch((error) => {
        platform.logger.log('warn', '[ecommerce] 旧画布节点只读兼容失败', {
          error: String(error),
        })
      })
    return () => {
      cancelled = true
    }
  }, [platform, projectId])
  const graph = useMemo(() => ({ nodes: legacyNodes }), [legacyNodes])
  const taskRepo = useMemo(() => createEcommerceTaskRepository(platform.storage), [platform])
  const runLogs = useMemo(
    () => createRunLogRepository(platform.storage),
    [platform],
  )
  const canvasRepo = useMemo(
    () => createEcommerceCanvasRepository(platform.storage),
    [platform],
  )
  const assetLibraryRepo = useMemo(
    () => createAssetLibraryRepository(platform.storage),
    [platform],
  )
  const [projectName, setProjectName] = useState('')
  /**
   * 结果真源是 `ecommerceTasks` / `ecommerceResults`（对账 #399 第二期）。
   *
   * 画布节点仍负责跑引擎与承载产物，但界面不再从节点反推"这一批出过什么"。
   * 旧项目没有任务行时才走 `legacyNodeIds` 兜底，并在下一次生成时写入新表。
   */
  const [activeTask, setActiveTask] = useState<EcommerceTaskRecord | null>(null)
  const [resultRows, setResultRows] = useState<EcommerceResultRecord[]>([])
  const [taskLoaded, setTaskLoaded] = useState(false)
  const [taskHistory, setTaskHistory] = useState<EcommerceTaskRecord[]>([])
  const [canvasItems, setCanvasItems] = useState<EcommerceCanvasItem[]>([])
  const canvasItemsRef = useRef<EcommerceCanvasItem[]>([])
  const [workbenchResults, setWorkbenchResults] = useState<EcommerceResultRecord[]>([])
  const [workbenchRuns, setWorkbenchRuns] = useState<RunRecord[]>([])
  const canvasSaveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const workbenchRefreshQueueRef = useRef<Promise<void>>(Promise.resolve())
  const legacyNodeIds = useMemo(() => {
    if (!taskLoaded || activeTask) return []
    return graph.nodes
      .filter((n) => {
        if (n.type !== 'generation') return false
        const data = n.data as { prompt?: unknown }
        const prompt = data.prompt
        return typeof prompt === 'string' && prompt.trim().length > 0
      })
      .map((n) => n.id)
  }, [graph.nodes, taskLoaded, activeTask])
  const nodeIds = activeTask ? activeTask.nodeIds : legacyNodeIds
  /**
   * 出图模型（用户 2026-10-10 #2）。空串 = 默认：由 `channels.defaultForNewNode` 解析。
   *
   * 清单取的是**固定前端显示名**（与画布创作面板同一份 `panelModelOptions('image')`）——
   * 渠道拉回来的裸模型名不进这个列表，理由见 `modelCatalog` 的注释（对账 #371）。
   */
  const [model, setModel] = useState('')
  /** `undefined` = 读取中，`null` = 无草稿；读取完成前不渲染工作台。 */
  const [savedDraft, setSavedDraft] = useState<EcommerceFormDraft | null | undefined>(undefined)
  const [initialUploads, setInitialUploads] = useState<{
    products: EcommerceUpload[]
    references: EcommerceUpload[]
  }>({ products: [], references: [] })
  const draftLatest = useRef<EcommerceFormDraft | null>(null)
  const draftActions = useMemo(
    () =>
      createEcommercePageDraftActionCoordinator({
        projectId,
        repository: {
          load: (id) => loadEcommerceDraft(platform.storage, id),
          nodes: async (id) =>
            (await platform.storage.query('nodes', { projectId: id })) as unknown as LegacyGenerationNode[],
          save: (id, draft) => saveEcommerceDraft(platform.storage, id, draft),
        },
        assets: platform.assets,
        scheduler: {
          setTimeout: (callback, milliseconds) => window.setTimeout(callback, milliseconds),
          clearTimeout: (timer) => window.clearTimeout(timer),
        },
        state: {
          getLatest: () => draftLatest.current,
          setLatest: (draft) => {
            draftLatest.current = draft
          },
        },
      }),
    [platform, projectId],
  )
  /** 长图面板开不开（对账 #420）：纯 UI 态，不落库 */
  const [longOpen, setLongOpen] = useState(false)
  /**
   * 「一句话 → 待确认方案」（对账 #422）。
   *
   * 三份状态刻意分开：`intent` 是**草稿**（还没进表单）、`intentError` 是**如实说**
   * （解析失败 / 超时 / 没配模型），`parsingIntent` 只管按钮。
   * 草稿**不落库** —— 它是"这句话可以变成什么"，不是用户已经定下来的东西。
   */
  const [intent, setIntent] = useState<EcommerceIntentDraft | null>(null)
  const [intentError, setIntentError] = useState('')
  const [parsingIntent, setParsingIntent] = useState(false)
  /**
   * **历史方案**（对账 #433）：一次成功的解析留一条，存在 `agentSessions`（项目级会话表，
   * 不新建表）。以前这些都只活在组件状态里 —— 刷新、切走、关掉再回来就没了，
   * 昨天想好的"亚马逊英文详情页 4 张、突出防水材质"今天得重打一遍。
   */
  const planSessions = useMemo(() => createAgentSessionStore(platform.storage), [platform])
  const [planHistory, setPlanHistory] = useState<EcommercePlanSession[]>([])
  /**
   * 这一次的分镜从哪来（对账 #406）：跑完如实显示。空串 = 这一趟没这回事，不显示。
   */
  const [shotPlanNote, setShotPlanNote] = useState('')
  /**
   * **分镜那一次对话请求也要算进"忙"**：它发生在建节点之前，
   * `exec.isRunning` 这时还是 false —— 不盖住的话按钮照样能点，
   * 用户点两下就花两次对话额度（而且要等两遍）。
   */
  const [preparingShots, setPreparingShots] = useState(false)
  /** 文字调用已成功、但运行记录落库失败时的持久可见提示。 */
  const [textRecordWarning, setTextRecordWarning] = useState('')
  /**
   * 只覆盖“校验 → 分析 → 建节点 → 提交 API”这段提交期。
   * 请求一旦发出，结果行和占位已经可见，按钮必须释放，允许用户继续下一批；
   * 不能用 `exec.isRunning` 把按钮锁到所有图片都返回。
   */
  const [submitting, setSubmitting] = useState(false)
  const [generationStage, setGenerationStage] = useState<EcommerceGenerationStage | null>(null)
  const showTextRecordWarning = useCallback((warning: string) => {
    platform.logger.log('warn', '[ecommerce] 文字调用运行记录写入失败', { warning })
    setTextRecordWarning(`结果已返回，但运行记录写入失败：${warning}`)
  }, [platform])
  const customModels = useSyncExternalStore(
    channels.subscribe,
    () => channels.getState().customModels,
    () => channels.getState().customModels,
  )
  const uncommonModelIds = useSyncExternalStore(
    channels.subscribe,
    () => channels.getState().uncommonModelIds,
    () => channels.getState().uncommonModelIds,
  )
  const uncommonModels = useMemo(() => new Set(uncommonModelIds), [uncommonModelIds])
  const models = useMemo(
    () => channels.globalModelsOf('image').map((item) => item.id),
    [channels, customModels, uncommonModelIds],
  )
  const videoModels = useMemo(
    () => channels.globalModelsOf('video').map((item) => item.id),
    [channels, customModels, uncommonModelIds],
  )
  const imageParamOptionsByModel = useMemo(
    () => imageParamOptionsOfModels(models),
    [models],
  )
  /**
   * 平台清单 = 内置 + **扩展包带进来的规则**（对账 #386 的 E3）。
   *
   * 同 id 时以扩展包为准：包就是用来"更新规则而不必等应用发版"的，
   * 若被内置那份压住，这个机制就白做了。
   */
  const [platforms, setPlatforms] = useState<readonly EcommercePlatform[]>(ECOMMERCE_PLATFORMS)

  const refreshWorkbench = useCallback(
    async (viewportWidth = Math.max(760, Math.round(window.innerWidth * 0.72))) => {
      const snapshot = await refreshEcommerceWorkbench({
        projectId,
        canvasSaveQueue: canvasSaveQueueRef.current,
        taskRepo,
        canvasRepo,
        runLogs,
      }, viewportWidth)
      canvasItemsRef.current = snapshot.items
      setCanvasItems(snapshot.items)
      setWorkbenchResults(snapshot.results)
      setWorkbenchRuns(snapshot.runs)
    },
    [canvasRepo, projectId, runLogs, taskRepo],
  )
  const queueWorkbenchRefresh = useCallback(
    (viewportWidth?: number) => {
      const next = workbenchRefreshQueueRef.current
        .catch(() => undefined)
        .then(() => refreshWorkbench(viewportWidth))
      workbenchRefreshQueueRef.current = next.catch(() => undefined)
      return next
    },
    [refreshWorkbench],
  )

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const extra = await createPackStore(platform.storage).platforms()
      if (cancelled || extra.length === 0) return
      const byId = new Map<string, EcommercePlatform>(
        ECOMMERCE_PLATFORMS.map((p) => [p.id, p]),
      )
      const known = new Set<string>(ECOMMERCE_LANGUAGES)
      for (const p of extra) {
        byId.set(p.id, {
          ...p,
          countHint: p.countHint ?? '',
          /* 包里的语言代码是**未受信任的输入**：只留我们认识的，别把 'xx' 拼进提示词 */
          languages: p.languages.filter((l): l is EcommerceLanguage => known.has(l)),
        })
      }
      setPlatforms([...byId.values()])
    })()
    return () => {
      cancelled = true
    }
  }, [platform])

  /** 项目名（标题下面那行）—— 读一次即可 */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const repo = createProjectRepository(platform.storage)
      const project = await repo.get(projectId)
      if (!cancelled) setProjectName(project?.name ?? '')
    })()
    return () => {
      cancelled = true
    }
  }, [platform, projectId])

  /** 读回草稿；悬空引用由协调器清理，宿主只应用可渲染的投影。 */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const restored = await draftActions.restore(() => cancelled)
      if (!restored || cancelled) return
      if (restored.draft) setModel(restored.draft.model)
      setInitialUploads({
        products: restoredUploadsOf(restored.products),
        references: restoredUploadsOf(restored.references),
      })
      setSavedDraft(restored.draft)
      draftLatest.current = restored.draft
    })()
    return () => {
      cancelled = true
    }
  }, [draftActions])

  /** 从自己的结果表读回最近一批；老项目没有任务行时 `taskLoaded=true` + 空任务走节点兜底。 */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const loaded = await loadEcommerceInitialTask({
        projectId,
        canvasSaveQueue: canvasSaveQueueRef.current,
        taskRepo,
        canvasRepo,
        runLogs,
      })
      if (cancelled) return
      setActiveTask(loaded.activeTask)
      setResultRows(loaded.resultRows)
      setTaskHistory(loaded.taskHistory)
      setTaskLoaded(true)
      await refreshWorkbench()
      /**
       * 共享存储写入刚落盘时，首屏偶尔会读到少一条结果的旧快照。
       * 工作台投影是纯派生数据，二次同步没有副作用，却能避免“刷新后才出现”。
       */
      await new Promise((resolve) => window.setTimeout(resolve, 220))
      if (!cancelled) await refreshWorkbench()
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, refreshWorkbench, taskRepo])

  /** 刷新历史批次列表（#399 第二期 / #479 的任务列表 UI）。 */
  const refreshTaskHistory = useCallback(async () => {
    try {
      setTaskHistory(await taskRepo.list(projectId))
    } catch (e) {
      platform.logger.log('warn', '[ecommerce] 任务历史读取失败', { error: String(e) })
    }
  }, [platform, projectId, taskRepo])

  const removeFailedResult = useCallback(
    async (taskId: string, resultId: string) => {
      const next = await taskRepo.removeResult(resultId)
      if (!next) return
      if (activeTask?.id === taskId) {
        setActiveTask(next.task)
        setResultRows(next.results)
      }
      await refreshTaskHistory()
      await refreshWorkbench()
    },
    [activeTask?.id, refreshTaskHistory, refreshWorkbench, taskRepo],
  )

  const handleCanvasItemsChange = useCallback(
    (next: EcommerceCanvasItem[]) => {
      const diff = projectEcommerceCanvasItemDiff(canvasItemsRef.current, next)
      canvasItemsRef.current = diff.next
      setCanvasItems(diff.next)
      void Promise.all([
        ...diff.hiddenResultIds.map((resultId) => taskRepo.setResultHidden(resultId, true)),
        ...diff.restoredResultIds.map((resultId) => taskRepo.setResultHidden(resultId, false)),
      ]).catch((error) => {
        platform.logger.log('warn', '[ecommerce] 工作台结果显隐保存失败', {
          error: String(error),
        })
      })
      canvasSaveQueueRef.current = canvasSaveQueueRef.current
        .then(() => canvasRepo.replace(projectId, diff.next))
        .catch((error) => {
          platform.logger.log('warn', '[ecommerce] 工作台布局保存失败', { error: String(error) })
        })
    },
    [canvasRepo, platform, projectId, taskRepo],
  )

  /** 点一条历史批次：把结果区切到那一批，不改表单、不重跑。 */
  const onSelectTask = useCallback(
    async (taskId: string) => {
      const task = taskHistory.find((item) => item.id === taskId)
      if (!task) return
      const rows = await taskRepo.results(taskId)
      setActiveTask(task)
      setResultRows(rows)
      setTaskLoaded(true)
    },
    [taskHistory, taskRepo],
  )

  /** 删一条历史批次；删的是当前批次就自动切到剩下最近一批。 */
  const onRemoveTask = useCallback(
    async (taskId: string) => {
      try {
        await taskRepo.remove(taskId)
        const list = await taskRepo.list(projectId)
        setTaskHistory(list)
        if (activeTask?.id === taskId) {
          const next = list[0] ?? null
          setActiveTask(next)
          setResultRows(next ? await taskRepo.results(next.id) : [])
        }
      } catch (e) {
        platform.logger.log('warn', '[ecommerce] 删除任务批次失败', { error: String(e) })
      }
    },
    [activeTask, platform, projectId, taskRepo],
  )
  /** 表单变化走协调器的 500ms 防抖；离页与卸载由下方生命周期 flush。 */
  const handleDraftChange = useCallback(
    (draft: EcommerceFormDraft) => {
      setSavedDraft(draft)
      draftActions.change(draft)
    },
    [draftActions],
  )

  useEffect(() => {
    const onHide = () => draftActions.flush()
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      draftActions.dispose()
    }
  }, [draftActions])

  /**
   * 对话模型下拉保持固定的前端清单，不按当前渠道增删。
   * 渠道是实现细节，真正请求时再按全局选路策略解析。
   *
   * 用 `useSyncExternalStore` 而不是读一次：用户去设置页改完渠道再切回来，
   * 这一栏的按钮状态必须立刻跟上，否则会停在"没有可用的对话模型"上，看起来像坏了。
   */
  const channelList = useSyncExternalStore(
    channels.subscribe,
    () => channels.getState().channels,
    () => channels.getState().channels,
  )
  const editModels = useMemo(() => {
    const enabled = channelList.filter((channel) => channel.enabled)
    return logicalNames(enabled).filter((name) => {
      if (uncommonModels.has(name)) return false
      const capability = capabilityOfLogical(enabled, name)
      return capability?.category === 'image' && capability.inputTypes.includes('image')
    })
  }, [channelList, uncommonModels])
  const upscaleProfiles = useMemo(
    () =>
      ECOMMERCE_UPSCALE_OPTIONS.filter((option) =>
        !uncommonModels.has(option.model) &&
        channelList.some((channel) =>
          channel.enabled &&
          channel.models.some(
            (model) => model.id === option.model && model.category === 'image',
          ),
        ),
      ).map((option) => option.id),
    [channelList, uncommonModels],
  )
  const routeStrategy = useSyncExternalStore(
    channels.subscribe,
    () => channels.getState().routeStrategy,
    () => channels.getState().routeStrategy,
  )
  const intentModelOptions = useMemo(
    () => panelModelOptions('chat', uncommonModelIds),
    [uncommonModelIds],
  )
  const [intentModel, setIntentModel] = useState('')
  const chatTarget = useMemo(
    () => {
      const selected = intentModelOptions.includes(intentModel)
        ? intentModel
        : (intentModelOptions.find(
            (name) => resolveRoutedChatTarget(channelList, name, routeStrategy) !== null,
          ) ?? intentModelOptions[0] ?? '')
      const route = resolveRoutedChatTarget(channelList, selected, routeStrategy)
      return route
        ? {
            channelId: route.channelId,
            logicalModel: route.logicalModel,
            upstreamModel: route.upstreamModel,
          }
        : null
    },
    [channelList, intentModel, intentModelOptions, routeStrategy],
  )

  const planningActions = useMemo(
    () =>
      createPagePlanningActionCoordinator({
        projectId,
        platforms,
        sessions: {
          list: (id) => planSessions.list(id),
          create: (input) => planSessions.create(input),
          save: (session, messages) =>
            planSessions.save({ ...session, messages: [...messages] }),
          remove: (id) => planSessions.remove(id),
        },
        assets: platform.assets,
        logger: platform.logger,
        completeWithTools: (request) =>
          channels.completeWithTools(request) as Promise<{ text: string }>,
        onTextRecordWarning: showTextRecordWarning,
        state: {
          setIntent,
          setIntentError,
          setParsingIntent,
          setPlanHistory,
          setPreparingShots,
          setTextRecordWarning,
          setGenerationStage,
        },
      }),
    [channels, planSessions, platform, platforms, projectId, showTextRecordWarning],
  )
  const {
    refreshPlanHistory,
    parseIntent,
    writeSellingPoints,
    restorePlan,
    removePlan,
    planShots,
    requestShots,
    visualInputsFor,
  } = planningActions

  useEffect(() => {
    void refreshPlanHistory()
  }, [refreshPlanHistory])

  const onParseIntent = (text: string) => parseIntent(text, chatTarget)
  const onWriteSellingPoints = (request: EcommerceRequest) =>
    writeSellingPoints(request, chatTarget)
  const onRestorePlan = restorePlan
  const onRemovePlan = removePlan
  const onPlanShots = (request: EcommerceRequest) =>
    planShots(request, chatTarget, graph.nodes)

  const onUpload = async (file: File, _kind: 'product' | 'reference'): Promise<EcommerceUpload | null> => {
    const asset = await importEcommerceAsset({ platform, projectId, file })
    if (!asset) return null
    return {
      nodeId: asset.hash,
      hash: asset.hash,
      preview: <ResultPreview hash={asset.hash} />,
      ...(asset.width ? { width: asset.width } : {}),
      ...(asset.height ? { height: asset.height } : {}),
    }
  }

  const onWorkbenchUpload = async (
    file: File,
  ): Promise<{ hash: string; width?: number; height?: number } | null> => {
    const uploaded = await onUpload(file, 'product')
    return uploaded
      ? {
          hash: uploaded.hash,
          ...(uploaded.width ? { width: uploaded.width } : {}),
          ...(uploaded.height ? { height: uploaded.height } : {}),
        }
      : null
  }

  const generationActions = createPageGenerationActionCoordinator({
    projectId,
    activeTask,
    taskHistory,
    workbenchResults,
    resultRows,
    platforms,
    channels: channelList,
    channelStore: channels,
    strategy: routeStrategy,
    chatTarget,
    nodes: graph.nodes,
    taskRepo,
    reconcile: (projectId) => taskRepo.reconcileFromRunRecords(projectId),
    canvasSaveQueue: () => canvasSaveQueueRef.current,
    canvasRepo,
    runLogs,
    assets: platform.assets,
    /*
     * 宿主只提供 execution 实例；后台 `void exec.run(runPlan)`、轮询和 lease
     * 收口都由生成协调器拥有。
     */
    execution: exec,
    logger: platform.logger,
    refresh: {
      history: refreshTaskHistory,
      workbench: queueWorkbenchRefresh,
    },
    requestShots,
    visualInputsFor,
    nextBatchId: () => {
      const batchId = ecommerceBatchId()
      return batchId
    },
    state: {
      setSubmitting,
      setShotPlanNote,
      setPreparingShots,
      setGenerationStage,
      setGenerationFailed: (message) => setGenerationStage({ phase: 'failed', label: '生成失败', detail: message }),
      setActiveTask,
      setResultRows,
    },
  })
  const {
    onGenerate,
    runStoredResult,
    retrySaveWorkbenchResult,
    retryWorkbenchResult,
  } = generationActions
  const handleWorkbenchAction = useCallback(
    () => workbenchActionOf({
      projectId,
      workbenchResults,
      resultRows,
      activeTask,
      platform,
      assetLibraryRepo,
      retryWorkbenchResult,
      downloadAsset,
      setGenerationStage,
    }),
    [
      assetLibraryRepo,
      platform,
      projectId,
      resultRows,
      retryWorkbenchResult,
      workbenchResults,
    ],
  )

  const resultLibraryActions = useMemo(
    () => createResultLibraryActions({
      projectId,
      platform,
      assetLibraryRepo,
      logger: platform.logger,
    }),
    [assetLibraryRepo, platform, projectId],
  )

  const results = useMemo<EcommerceResultItem[]>(() => {
    return projectEcommerceResults({
      activeTask,
      resultRows,
      nodeIds,
      nodes: graph.nodes,
      legacyAssetHashesOfNode: (node) => node ? legacyAssetHashesOfNode(node) : [],
      resultStateOf: (resultId) => exec.resultStateOf(resultId),
      previewOf: (hash, mime) => <ResultPreview hash={hash} mime={mime} />,
      downloadOf: resultLibraryActions.downloadOf,
      saveToLibraryOf: resultLibraryActions.saveToLibraryOf,
      errorDescriptionOf: describeError,
      runStoredResult,
      retryWorkbenchResult,
      retrySaveWorkbenchResult,
      removeFailedResult,
    })
  }, [
    activeTask,
    resultRows,
    nodeIds,
    exec,
    graph.nodes,
    platform,
    projectId,
    runStoredResult,
    assetLibraryRepo,
    resultLibraryActions,
    taskRepo,
  ])

  /*
   * 阶段条的第二条真相来源：页面已经拿到的结果状态。
   *
   * 单张执行 Promise 在跨路由 / 并发批次的收尾时机并不适合作为唯一进度来源；
   * 只要结果表或实时节点状态已经给出终态，就在这里补齐 x/N 与“已结束”，
   * 避免结果卡已经完成而阶段条还停在 1/N。
   */
  useEffect(() => {
    if (!activeTask || results.length === 0) return
    setGenerationStage((current) => generationStageOfTerminalResults(current, results))
  }, [activeTask, results])

  const resultActions = createPageResultActionCoordinator({
    activeTask,
    resultRows,
    results,
    channels: channelList,
    platform,
    onGenerate,
    retryWorkbenchResult,
  })
  const editResult = resultActions.editResult
  const editResults = resultActions.editResults
  const upscaleResult = resultActions.upscaleResult

  const failedCount = results.filter((r) => r.status === 'failed').length
  const downloadableCount = results.filter((r) => r.status === 'done' && r.imageHash).length

  /** 串行下载当前批次；并发触发多个下载会被浏览器拦。 */
  const downloadAll = useCallback(
    () => downloadAllResults({ results, platform }),
    [platform, results],
  )

  /** 一键重试失败 / 取消的结果；逐张跑，全部走既有执行链路。 */
  const retryFailed = useCallback(
    () => retryFailedResults({
      activeTask,
      resultRows,
      results,
      retryWorkbenchResult,
    }),
    [
      activeTask,
      retryWorkbenchResult,
      resultRows,
      results,
    ],
  )

  /**
   * 长图拼合的输入（对账 #420）：只取**已完成且有真实像素**的。
   *
   * `results` 本身是 memo（依赖执行状态与图），空闲时引用稳定 ⇒ 长图不会每帧重画。
   */
  const longTiles = useMemo<LongImageTileSource[]>(
    () => longImageTilesOf(results),
    [results],
  )

  /* 草稿读出来再挂工作台：否则会先闪一版默认值，再把刚恢复的上传槽顶掉。 */
  if (savedDraft === undefined) return null

  return (
    <EcommerceStudio
      projectName={projectName || '未命名项目'}
      initialDraft={savedDraft}
      initialProducts={initialUploads.products}
      initialReferences={initialUploads.references}
      onDraftChange={handleDraftChange}
      platforms={platforms}
      models={models}
      videoModels={videoModels}
      imageParamOptionsByModel={imageParamOptionsByModel}
      editModels={editModels}
      model={model}
      onModelChange={setModel}
      onUpload={onUpload}
      onWriteSellingPoints={onWriteSellingPoints}
      onGenerate={onGenerate}
      onEditResult={editResult}
      onEditResults={editResults}
      onUpscaleResult={upscaleResult}
      upscaleProfiles={upscaleProfiles}
      running={submitting || preparingShots}
      results={results}
      workbench={
        <EcommerceWorkbench
          projectId={projectId}
          items={canvasItems}
          results={workbenchResults}
          tasks={taskHistory}
          runs={workbenchRuns}
          activeResults={resultRows}
          running={exec.isRunning}
          availableActions={['download', 'save', 'retry']}
          onItemsChange={handleCanvasItemsChange}
          onCanvasUpload={onWorkbenchUpload}
          onAction={handleWorkbenchAction}
          channelLabelOf={(channelId) =>
            channelList.find((channel) => channel.id === channelId)?.name ?? channelId
          }
          onRemoveFailed={(resultId) => {
            const row =
              workbenchResults.find((result) => result.id === resultId) ??
              resultRows.find((result) => result.id === resultId)
            if (row) void removeFailedResult(row.taskId, resultId)
          }}
        />
      }
      onRetryFailed={failedCount > 0 ? () => void retryFailed() : undefined}
      failedCount={failedCount}
      onDownloadAll={downloadableCount > 0 ? () => void downloadAll() : undefined}
      downloadableCount={downloadableCount}
      onParseIntent={onParseIntent}
      parsingIntent={parsingIntent}
      intent={intent}
      planHistory={planHistory}
      onRestorePlan={onRestorePlan}
      onRemovePlan={onRemovePlan}
      taskHistory={taskHistory}
      activeTaskId={activeTask?.id ?? ''}
      onSelectTask={(taskId) => void onSelectTask(taskId)}
      onRemoveTask={(taskId) => void onRemoveTask(taskId)}
      chatTargetLabel={chatTarget?.logicalModel ?? ''}
      chatModels={intentModelOptions}
      intentModel={intentModel}
      onIntentModelChange={setIntentModel}
      onConfigureChannels={() => openGlobalSettings('channels')}
      intentError={intentError}
      onIntentApplied={() => setIntent(null)}
      onIntentDiscard={() => {
        setIntent(null)
        setIntentError('')
      }}
      onPlanShots={onPlanShots}
      shotPlanNote={shotPlanNote}
      generationStage={generationStage}
      textRecordWarning={textRecordWarning}
      onOpenLongImage={() => setLongOpen(true)}
      longImage={(tools) =>
        longOpen ? (
          <LongImagePanel
            tiles={longTiles}
            tools={tools}
            onClose={() => setLongOpen(false)}
          />
        ) : null
      }
    />
  )
}
