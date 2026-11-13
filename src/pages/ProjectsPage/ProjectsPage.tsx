import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePlatform } from '../../app/providers/PlatformProvider'
import { createProjectRepository, type ProjectRepository } from '../../state/project/repository'
import {
  createProjectListStore,
  type ProjectListStore,
  type ProjectSort,
} from '../../state/project/listStore'
import { projectRoute, WORKBENCHES, WORKBENCH_ORDER, type WorkbenchId } from '../../domain/shared/workbench'
import { noticeA11y } from '../../domain/ui/notice'
import { formatRelative } from '../../domain/shared/time'
import { toggleProjectSelection } from '../../domain/project/selection'
import { TEMPLATES, type TemplateId } from '../../state/project/templates'
import type { ProjectListItem } from '../../domain/project/project'
import { Check, Icon } from '../../ui/icon'
import styles from './ProjectsPage.module.css'
import { ChoicePicker } from '../../features/shared/choicePicker/ChoicePicker'
import {
  getProjectRuntimePendingSnapshot,
  subscribeProjectRuntimePending,
} from '../../app/ProjectRuntimeRegistry'
import {
  IconSelect,
  IconTrash,
  HomeEmptyState,
  ProjectCard,
} from './ProjectsPageViews'
import { PROJECT_KIND_ORDER, projectKindCounts, projectsForKind, type ProjectKind } from './projectListProjection'
import { requestNewProjectChoice } from '../../state/ui/newProjectChoice'
import {
  TRASH_KEEP_DAYS,
  pruneTrashSelection,
  selectAllTrash as selectAllTrashItems,
  toggleTrashItem as toggleTrashItemModel,
  toggleVisibleProjects,
  trashProjection,
} from './projectSelectionModel'
import { deletionNotice, projectCleanupNotice, projectFailureNotice, trashRestoreNotice, type ProjectNotice } from './projectResultPresentation'
import { deleteProjectsWithRuntime, reportDeleteFailure, retryProjectCleanup } from './projectDeletionCoordinator'
import { dropProjectFlow, exportProjectFlow, importProjectFlow, type ProjectActionPorts } from './projectsPage/projectActionCoordinator'

export { HomeEmptyState, ProjectCard } from './ProjectsPageViews'

/**
 * 项目页（产品文档 §5.1 / §5.3；路由 `/projects`）。
 *
 * 原名 `HomePage`。2026-09-27 应用壳改版时**一分为二**：
 * 这里只留「项目网格」这件正事，品牌 / 欢迎 / 一级导航
 * 全部交给应用壳（§5.2「首页不再有自己的顶栏」）。
 *
 * 为什么是改名而不是并存两个页面：原来那个 `HomePage` 里根本没有「欢迎」内容
 * —— 它从第一版起就是项目网格。把它叫「首页」才是一直以来的错位，
 * 现在按它实际干的事命名。
 */
export function ProjectsPage() {
  const platform = usePlatform()
  const navigate = useNavigate()

  // 仓库与列表 store 跟随首页生命周期创建一次（直连 platform.storage）
  const repoRef = useRef<ProjectRepository | null>(null)
  if (!repoRef.current) repoRef.current = createProjectRepository(platform.storage)
  const repo = repoRef.current
  const storeRef = useRef<ProjectListStore | null>(null)
  if (!storeRef.current) {
    storeRef.current = createProjectListStore(repo)
  }
  const store = storeRef.current

  const visible = useSyncExternalStore(store.subscribe, () => store.getState().visible, () => store.getState().visible)
  /**
   * 项目类型筛选（用户 2026-10-10 #5：「画布项目菜单的工作区中，项目和电商项目需要进行分类」）。
   *
   * 数据本来就已经分开了 —— `projects.workbench` 在建项目时就写着 `canvas` / `ecommerce`
   *（见 `domain/project/project.ts`），只是列表从来不按它分。这里只补**视图层**的筛选与标识，
   * 真正的"两个独立工作区"（各自的存储与数据模型）见对账 #396。
   */
  const [kindFilter, setKindFilter] = useState<ProjectKind>('all')
  const shown = projectsForKind(visible, kindFilter)
  const kindCounts = projectKindCounts(visible)
  const loading = useSyncExternalStore(store.subscribe, () => store.getState().loading, () => store.getState().loading)
  const sort = useSyncExternalStore(store.subscribe, () => store.getState().sort, () => store.getState().sort)
  const query = useSyncExternalStore(store.subscribe, () => store.getState().query, () => store.getState().query)
  const pendingRuntimeOperations = useSyncExternalStore(
    subscribeProjectRuntimePending,
    getProjectRuntimePendingSnapshot,
    getProjectRuntimePendingSnapshot,
  )

  // 交互态
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [menuId, setMenuId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [cleanupOperationId, setCleanupOperationId] =
    useState<number | null>(null)
  const cleanupRuntimeOperation = pendingRuntimeOperations.find(
    (operation) =>
      operation.id === cleanupOperationId,
  )
  const cleanupPending =
    cleanupRuntimeOperation?.status === 'cleanup_failed'
      ? cleanupRuntimeOperation
      : null
  const cleanupCommitting =
    cleanupRuntimeOperation?.status === 'committing'
  const [status, setStatusText] = useState('')
  const [statusTone, setStatusTone] = useState<ProjectNotice['tone']>('info')
  /**
   * 写状态行的**唯一入口**：默认 `info`，失败那几处显式传 `'error'`。
   *
   * 这样写而不是"另开一个 setTone"：语气**跟着这一次写入走**，不会出现
   * "上一条是失败、这一条是成功，但 role 还留在 alert"的残留。
   */
  const notice = useCallback((next: ProjectNotice) => {
    setStatusText(next.text)
    setStatusTone(next.tone)
  }, [])
  const setStatus = useCallback((text: string, tone: ProjectNotice['tone'] = 'info') => {
    notice({ text, tone })
  }, [notice])
  const reportFailure = useCallback(
    (error: unknown, prefix: string) =>
      reportDeleteFailure(
        {
          status: notice,
          setCleanupOperationId,
        },
        error,
        prefix,
      ),
    [notice],
  )
  /** 正拖着文件停在这一页上（决定要不要显那层「松开即导入」的提示） */
  const [dragging, setDragging] = useState(false)
  /** 项目多选模式（用户 2026-09-28）：选择态下卡片点击不再进入画布 */
  const [selecting, setSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set())
  const [bulkConfirm, setBulkConfirm] = useState(false)
  /** 「+ 新建」的工作台选择浮层（null = 未展开；坐标 = 展开位置） */
  const [newMenu, setNewMenu] = useState<{ x: number; y: number } | null>(null)
  /**
   * 回收站（对账 #378 A3）。
   *
   * 进回收站的项目**不在项目列表里**，所以它单独一份状态、按需读取 ——
   * 不给主列表增加"显示已删除"这种会让用户害怕的开关。
   */
  const [trashOpen, setTrashOpen] = useState(false)
  const [trashItems, setTrashItems] = useState<ProjectListItem[]>([])
  const [trashSelectedIds, setTrashSelectedIds] = useState<ReadonlySet<string>>(new Set())
  const [trashSelectionAnchor, setTrashSelectionAnchor] = useState<string | null>(null)
  const [trashBusy, setTrashBusy] = useState(false)
  const [trashConfirmBulk, setTrashConfirmBulk] = useState(false)
  const [trashConfirmClear, setTrashConfirmClear] = useState(false)
  /** 「清理 30 天前」的二次确认（与清空回收站同一套：先点一次变文案，再点才真删） */
  const [trashConfirmOld, setTrashConfirmOld] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        await platform.storage.open()
      } catch (error) {
        if (alive) {
          setStatus(
            `项目列表读取失败：${error instanceof Error ? error.message : String(error)}`,
            'error',
          )
        }
        return
      }
      await store.load()
      const error = store.getState().error
      if (alive && error) setStatus(`项目列表读取失败：${error}`, 'error')
    })()
    return () => {
      alive = false
    }
  }, [platform.storage, setStatus, store])

  const createBlank = async (workbench: WorkbenchId = 'canvas') => {
    // 不传 name：由 domain 按 workbench 取默认名（现只有 canvas「未命名项目」）
    const item = await store.create({ workbench })
    navigate(projectRoute(item.workbench, item.id))
  }

  /** 从「+ 新建」浮层选一个工作台创建 */
  const createWithWorkbench = (workbench: WorkbenchId) => {
    setNewMenu(null)
    void createBlank(workbench)
  }

  const createFromTemplate = async (templateId: TemplateId, name: string) => {
    const item = await store.create({ name })
    navigate(projectRoute(item.workbench, item.id), { state: { template: templateId } })
  }

  const handleDelete = async (id: string) => {
    if (deletingId) return
    setDeletingId(id)
    try {
      await deleteProjectsWithRuntime([id], () => store.remove(id))
      setCleanupOperationId(null)
      setConfirmId(null)
      setMenuId(null)
    } catch (error) {
      reportFailure(error, '删除失败')
    } finally {
      setDeletingId((current) => current === id ? null : current)
    }
  }

  /** 打开 / 收起回收站：打开时现读一次，保证看到的是最新的一批 */
  const toggleTrash = async () => {
    if (trashOpen) {
      setTrashOpen(false)
      setTrashSelectedIds(new Set())
      setTrashSelectionAnchor(null)
      setTrashConfirmBulk(false)
      setTrashConfirmClear(false)
      setTrashConfirmOld(false)
      return
    }
    setTrashItems(await store.listDeleted())
    setTrashOpen(true)
    setTrashSelectedIds(new Set())
    setTrashSelectionAnchor(null)
    setTrashConfirmBulk(false)
    setTrashConfirmClear(false)
    setTrashConfirmOld(false)
    setMenuId(null)
    setConfirmId(null)
  }

  const refreshTrash = async () => {
    const next = await store.listDeleted()
    setTrashItems(next)
    setTrashSelectedIds((prev) => pruneTrashSelection(prev, next).selected)
    if (next.length === 0) {
      setTrashSelectedIds(new Set())
      setTrashSelectionAnchor(null)
      setTrashConfirmBulk(false)
      setTrashConfirmClear(false)
      setTrashConfirmOld(false)
    }
  }

  const retryRuntimeCleanup = async () => {
    await retryProjectCleanup(
      {
        status: notice,
        setCleanupOperationId,
        busy: () => busy,
        setBusy,
        load: () => store.load(),
        refreshTrash,
        trashOpen: () => trashOpen,
      },
      cleanupPending,
      cleanupCommitting,
    )
  }

  useEffect(() => {
    if (cleanupOperationId === null) return
    if (
      pendingRuntimeOperations.some(
        (operation) => operation.id === cleanupOperationId,
      )
    ) {
      return
    }
    setCleanupOperationId(null)
    notice(projectCleanupNotice())
  }, [
    cleanupOperationId,
    pendingRuntimeOperations,
    setStatus,
  ])

  const handleRestore = async (id: string) => {
    if (trashBusy) return
    setTrashBusy(true)
    try {
      await store.restore(id)
      await refreshTrash()
      setStatus('已从回收站还原')
    } catch (error) {
      notice(projectFailureNotice('还原失败', error))
    } finally {
      setTrashBusy(false)
    }
  }

  const handlePurge = async (id: string) => {
    if (trashBusy) return
    setTrashBusy(true)
    try {
      await deleteProjectsWithRuntime([id], () => store.purge(id))
      await refreshTrash()
      setCleanupOperationId(null)
      setStatus('已彻底删除（不可恢复）')
    } catch (error) {
      reportFailure(error, '彻底删除失败')
      await refreshTrash()
    } finally {
      setTrashBusy(false)
    }
  }

  const handlePurgeAll = async () => {
    if (trashBusy) return
    const total = trashItems.length
    setTrashBusy(true)
    setTrashConfirmClear(false)
    try {
      const n = await deleteProjectsWithRuntime(
        trashItems.map((project) => project.id),
        () => store.purgeAll(),
      )
      await refreshTrash()
      setCleanupOperationId(null)
      setStatus(`已清空回收站（${n} / ${total} 个项目）`)
    } catch (error) {
      reportFailure(
        error,
        '清空回收站失败，未完成的项目仍保留',
      )
      await refreshTrash()
    } finally {
      setTrashBusy(false)
    }
  }

  const toggleTrashItem = (id: string, shift: boolean) => {
    setTrashConfirmBulk(false)
    const next = toggleTrashItemModel(
      trashItems,
      trashSelectedIds,
      trashSelectionAnchor,
      id,
      shift,
    )
    setTrashSelectedIds(next.selected)
    setTrashSelectionAnchor(next.anchor)
  }

  const selectAllTrash = () => {
    const next = selectAllTrashItems(trashItems)
    setTrashSelectedIds(next.selected)
    setTrashSelectionAnchor(next.anchor)
    setTrashConfirmBulk(false)
  }

  const restoreTrashSelected = async () => {
    if (trashBusy || trashSelectedIds.size === 0) return
    setTrashBusy(true)
    const selected = [...trashSelectedIds]
    const failed: string[] = []
    let restored = 0
    for (const [index, id] of selected.entries()) {
      setStatus(`正在还原 ${index + 1} / ${selected.length} 个项目…`)
      try {
        await store.restore(id)
        restored += 1
      } catch {
        failed.push(id)
      }
    }
    await refreshTrash()
    setTrashSelectedIds(new Set(failed))
    setTrashSelectionAnchor(failed[0] ?? null)
    setTrashBusy(false)
    notice(trashRestoreNotice(restored, failed.length))
  }

  const purgeTrashSelected = async () => {
    if (trashBusy || trashSelectedIds.size === 0) return
    setTrashBusy(true)
    setTrashConfirmBulk(false)
    const selected = [...trashSelectedIds]
    try {
      const n = await deleteProjectsWithRuntime(
        selected,
        () => store.purgeMany(selected),
      )
      await refreshTrash()
      setTrashSelectedIds(new Set())
      setTrashSelectionAnchor(null)
      setCleanupOperationId(null)
      setStatus(`已彻底删除 ${n} 个项目（不可恢复）`)
    } catch (error) {
      reportFailure(
        error,
        '批量彻底删除失败，未完成的项目仍保留',
      )
      await refreshTrash()
    } finally {
      setTrashBusy(false)
    }
  }

  /**
   * **清理 30 天前**（对账 #409）：只提供"用户点一下"，后台不自动删。
   *
   * 为什么不做成自动：它删的是不可恢复的数据（连同节点 / 连线 / 记录一起清）。
   * 界面上把"有几个、要清哪些"写在按钮上，点两次才执行 —— 误触的代价必须由确认拦住。
   */
  const handlePurgeOld = async () => {
    if (trashBusy) return
    setTrashBusy(true)
    setTrashConfirmOld(false)
    try {
      const n = await deleteProjectsWithRuntime(
        trashProjection(trashItems, trashSelectedIds, Date.now()).oldIds,
        () => store.purgeOlderThan(TRASH_KEEP_DAYS),
      )
      await refreshTrash()
      setCleanupOperationId(null)
      setStatus(
        n > 0 ? `已清理 ${n} 个 ${TRASH_KEEP_DAYS} 天前的项目（不可恢复）` : `没有超过 ${TRASH_KEEP_DAYS} 天的项目`,
      )
    } catch (error) {
      reportFailure(error, '清理旧项目失败')
      await refreshTrash()
    } finally {
      setTrashBusy(false)
    }
  }

  const trashView = trashProjection(trashItems, trashSelectedIds, Date.now())
  const oldTrashCount = trashView.oldCount
  const trashSelectedCount = trashView.selectedCount
  const allTrashSelected = trashView.allSelected

  const visibleIds = shown.map((p) => p.id)
  const selectedCount = selectedIds.size

  const exitSelection = () => {
    setSelecting(false)
    setSelectedIds(new Set())
    setBulkConfirm(false)
  }

  const toggleSelectionMode = () => {
    if (selecting) {
      exitSelection()
      return
    }
    setMenuId(null)
    setConfirmId(null)
    setSelecting(true)
  }

  const toggleSelected = (id: string) => {
    setSelectedIds((current) => toggleProjectSelection(current, id))
    setBulkConfirm(false)
  }

  const toggleSelectVisible = () => {
    setSelectedIds((current) =>
      toggleVisibleProjects(current, visibleIds),
    )
    setBulkConfirm(false)
  }

  const clearSelected = () => {
    setSelectedIds(new Set())
    setBulkConfirm(false)
  }

  const handleBulkDelete = async () => {
    if (selectedCount === 0 || bulkDeleting) return
    const ids = [...selectedIds]
    setBulkDeleting(true)
    try {
      await deleteProjectsWithRuntime(ids, () => store.removeMany(ids))
      setMenuId(null)
      setConfirmId(null)
      exitSelection()
      setCleanupOperationId(null)
      notice(deletionNotice(selectedCount))
    } catch (error) {
      reportFailure(error, '批量删除失败')
    } finally {
      setBulkDeleting(false)
    }
  }

  const actionPorts: ProjectActionPorts = {
    platform,
    repo,
    status: notice,
    load: () => store.load(),
    busy: () => busy,
    setBusy,
    setDragging,
    closeMenu: () => setMenuId(null),
  }
  const handleImport = async () => {
    await importProjectFlow(actionPorts)
  }
  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    await dropProjectFlow(actionPorts, e)
  }
  const handleExport = async (id: string, name: string, opts?: { embedAssets?: boolean }) =>
    exportProjectFlow(actionPorts, id, name, opts)

  const startRename = (p: ProjectListItem) => {
    setRenamingId(p.id)
    setRenameValue(p.name)
    setMenuId(null)
  }
  const commitRename = async () => {
    if (renamingId) await store.rename(renamingId, renameValue)
    setRenamingId(null)
  }

  const handleDuplicate = async (id: string) => {
    await store.duplicate(id)
    setMenuId(null)
  }

  return (
    <div
      className={styles.page}
      data-projects-drop
      /**
       * 拖一个 `.flow.json` 进来就导入（对账 #234）。
       * `onDragOver` 必须 `preventDefault`，否则浏览器**根本不发 drop**（默认是"不接收"）。
       */
      onDragOver={(e) => {
        if (!e.dataTransfer?.types.includes('Files')) return
        e.preventDefault()
        if (!dragging) setDragging(true)
      }}
      onDragLeave={(e) => {
        // 只在真的离开这一页时收起提示：进出子元素也会触发 dragleave
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
        setDragging(false)
      }}
      onDrop={(e) => void handleDrop(e)}
    >
      {dragging && (
        <div className={styles.dropHint} data-projects-drop-hint>
          松开即导入这个 .flow.json
        </div>
      )}
      {/*
        ⛔ 这里原来有一条自己的顶栏（品牌 + 后台设置 + 主题切换）。
        产品文档 §5.2 明写「首页不再有自己的顶栏」：品牌与一级导航归应用壳侧栏，
        主题切换归侧栏底部。留着它会与侧栏出现**两套导航**。
      */}
      <main className={styles.main}>
        {/* —— 我的项目 —— */}
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <div className={styles.titleGroup}>
              <h2 className={styles.sectionTitle} data-projects-heading>
                项目
              </h2>
              {/* 类型筛选（用户 2026-10-10 #5）：画布项目与电商项目分开展示，计数直接写在按钮上 */}
              <div className={styles.kindFilter} role="radiogroup" aria-label="项目类型">
                {PROJECT_KIND_ORDER.map((kind) => {
                  const n = kindCounts.find((option) => option.id === kind.id)?.count ?? 0
                  return (
                    <button
                      key={kind.id}
                      type="button"
                      role="radio"
                      aria-checked={kindFilter === kind.id}
                      className={
                        kindFilter === kind.id ? `${styles.kindBtn} ${styles.kindBtnOn}` : styles.kindBtn
                      }
                      data-projects-kind-filter={kind.id}
                      onClick={() => setKindFilter(kind.id)}
                    >
                      {kind.label}
                      <span className={styles.kindCount}>{n}</span>
                    </button>
                  )
                })}
              </div>
              <button
                className={`${styles.selectToggle} ${selecting ? styles.selectToggleOn : ''}`}
                type="button"
                aria-label={selecting ? '退出选择项目' : '选择项目'}
                aria-pressed={selecting}
                title={selecting ? '退出选择' : '选择项目'}
                data-project-select-toggle
                onClick={toggleSelectionMode}
              >
                <IconSelect />
              </button>
            </div>
            <div className={styles.tools}>
              <input
                className={styles.search}
                type="search"
                placeholder="搜索项目"
                value={query}
                onChange={(e) => store.setQuery(e.target.value)}
                aria-label="搜索项目"
              />
              <ChoicePicker
                name="projects-sort"
                className={styles.sort}
                value={sort}
                ariaLabel="排序方式"
                options={[
                  { value: 'updated', label: '最近编辑' },
                  { value: 'created', label: '创建时间' },
                  { value: 'name', label: '名称 A-Z' },
                ]}
                onChange={(next) => store.setSort(next as ProjectSort)}
              />
              <button
                className={styles.importBtn}
                onClick={() => void handleImport()}
                disabled={busy}
              >
                导入
              </button>
              {/* 回收站：删除是可逆的，入口就得看得见（对账 #378 A3） */}
              <button
                className={styles.importBtn}
                data-projects-trash-toggle
                aria-pressed={trashOpen}
                onClick={() => void toggleTrash()}
              >
                回收站
              </button>
            </div>
          </div>

          {trashOpen && (
            <div className={styles.trashPanel} data-projects-trash>
              <div className={styles.trashHead}>
                <span className={styles.trashTitle}>
                  回收站（{trashItems.length}）
                </span>
                <span className={styles.trashHint}>
                  删除的项目在这里，可随时还原；彻底删除之后不可恢复
                </span>
                {trashItems.length > 0 && (
                  <button
                    className={styles.trashDanger}
                    data-projects-trash-clear
                    disabled={trashBusy}
                    onClick={() => {
                      if (trashConfirmClear) void handlePurgeAll()
                      else setTrashConfirmClear(true)
                    }}
                  >
                    {trashBusy
                      ? '处理中…'
                      : trashConfirmClear
                        ? '再点一次清空'
                        : '清空回收站'}
                  </button>
                )}
                {/*
                  「清理 N 天前」（对账 #409）：**只有用户点它才会删**。
                  数量写在按钮上，并沿用"点两次"的确认 —— 它删的是不可恢复的数据。
                */}
                {oldTrashCount > 0 && (
                  <button
                    className={styles.trashDanger}
                    data-projects-trash-purge-old
                    disabled={trashBusy}
                    onClick={() => {
                      if (trashConfirmOld) void handlePurgeOld()
                      else setTrashConfirmOld(true)
                    }}
                  >
                    {trashConfirmOld
                      ? `再点一次清理这 ${oldTrashCount} 个`
                      : `清理 ${TRASH_KEEP_DAYS} 天前（${oldTrashCount}）`}
                  </button>
                )}
              </div>
              {trashItems.length > 0 && (
                <div className={styles.trashBulk} data-projects-trash-bulk>
                  <button
                    type="button"
                    className={styles.ghost}
                    data-projects-trash-select-all
                    disabled={trashBusy}
                    onClick={() => {
                      if (allTrashSelected) {
                        setTrashSelectedIds(new Set())
                        setTrashSelectionAnchor(null)
                      } else {
                        selectAllTrash()
                      }
                    }}
                  >
                    {allTrashSelected ? '取消全选' : '全选'}
                  </button>
                  <span className={styles.trashSelectedCount}>
                    已选 {trashSelectedCount} / {trashItems.length}
                  </span>
                  <button
                    type="button"
                    className={styles.ghost}
                    data-projects-trash-restore-selected
                    disabled={trashBusy || trashSelectedCount === 0}
                    onClick={() => void restoreTrashSelected()}
                  >
                    还原所选
                  </button>
                  <button
                    type="button"
                    className={styles.trashDanger}
                    data-projects-trash-purge-selected
                    disabled={trashBusy || trashSelectedCount === 0}
                    onClick={() => {
                      if (trashConfirmBulk) void purgeTrashSelected()
                      else setTrashConfirmBulk(true)
                    }}
                  >
                    {trashConfirmBulk
                      ? `再点一次彻底删除这 ${trashSelectedCount} 个`
                      : '彻底删除所选'}
                  </button>
                </div>
              )}
              {trashItems.length === 0 ? (
                <p className={styles.trashEmpty} data-projects-trash-empty>
                  回收站是空的
                </p>
              ) : (
                <ul className={styles.trashList}>
                  {trashItems.map((p) => (
                    <li
                      key={p.id}
                      className={
                        trashSelectedIds.has(p.id)
                          ? `${styles.trashItem} ${styles.trashItemSelected}`
                          : styles.trashItem
                      }
                      data-projects-trash-item={p.id}
                      data-projects-trash-selected={trashSelectedIds.has(p.id) ? 'true' : 'false'}
                    >
                      <button
                        type="button"
                        className={styles.trashCheck}
                        data-projects-trash-check={p.id}
                        aria-label={trashSelectedIds.has(p.id) ? '取消选择项目' : '选择项目'}
                        aria-pressed={trashSelectedIds.has(p.id)}
                        disabled={trashBusy}
                        onClick={(event) => toggleTrashItem(p.id, event.shiftKey)}
                      >
                        {trashSelectedIds.has(p.id) && (
                          <Icon icon={Check} size="sm" />
                        )}
                      </button>
                      <span className={styles.trashName}>{p.name}</span>
                      <span className={styles.trashMeta}>
                        {p.deletedAt ? `删除于 ${formatRelative(p.deletedAt)}` : ''} · {p.nodeCount} 个节点
                      </span>
                      <button
                        className={styles.ghost}
                        data-projects-trash-restore={p.id}
                        disabled={trashBusy}
                        onClick={() => void handleRestore(p.id)}
                      >
                        还原
                      </button>
                      <button
                        className={styles.trashDanger}
                        data-projects-trash-purge={p.id}
                        disabled={trashBusy}
                        onClick={() => void handlePurge(p.id)}
                      >
                        彻底删除
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {shown.length === 0 && !loading ? (
            <HomeEmptyState onCreate={requestNewProjectChoice} />
          ) : (
            <div className={styles.grid}>
              {/* 参考图口径：新建项目是网格第一张，其余项目依次排开 */}
              <button
                className={styles.newCard}
                onClick={requestNewProjectChoice}
                data-new-card
              >
                <span className={styles.newPlus} aria-hidden>
                  ＋
                </span>
                <span className={styles.newLabel}>新建项目</span>
              </button>
              {shown.map((p) => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  selecting={selecting}
                  selected={selectedIds.has(p.id)}
                  confirming={confirmId === p.id}
                  deleting={deletingId === p.id}
                  menuOpen={menuId === p.id}
                  renaming={renamingId === p.id}
                  renameValue={renameValue}
                  onOpen={() => {
                    if (selecting) {
                      toggleSelected(p.id)
                      return
                    }
                    navigate(projectRoute(p.workbench, p.id))
                  }}
                  onRenameChange={setRenameValue}
                  onRenameCommit={commitRename}
                  onCancelRename={() => setRenamingId(null)}
                  onRequestDelete={() => {
                    // 同时收起菜单：否则关闭遮罩会盖住「确认 / 取消」，导致删除点不动
                    setConfirmId(p.id)
                    setMenuId(null)
                  }}
                  onConfirmDelete={() => void handleDelete(p.id)}
                  onCancelDelete={() => setConfirmId(null)}
                  onToggleMenu={() => setMenuId(menuId === p.id ? null : p.id)}
                  onCloseMenu={() => setMenuId(null)}
                  onStartRename={() => startRename(p)}
                  onDuplicate={() => void handleDuplicate(p.id)}
                  onExport={() => void handleExport(p.id, p.name)}
                  onExportWithAssets={() => void handleExport(p.id, p.name, { embedAssets: true })}
                />
              ))}
            </div>
          )}
        </section>

      </main>

      {/* 语气 → role / aria-live：一处决定（`domain/ui/notice.ts`）；data-status-tone 给冒烟读 */}
      <div className={styles.status} data-status-tone={statusTone} {...noticeA11y(statusTone)}>
        {status}
        {(cleanupPending || cleanupCommitting) && (
          <button
            type="button"
            className={styles.statusRetry}
            data-project-cleanup-retry
            disabled={!cleanupPending || busy || cleanupCommitting}
            onClick={() => void retryRuntimeCleanup()}
          >
            {cleanupCommitting || busy ? '清理中…' : '重试清理'}
          </button>
        )}
      </div>

      {selecting && (
        <div className={styles.bulkBar} data-project-bulk-bar>
          {bulkConfirm ? (
            <>
              <span className={styles.bulkText}>
                删除 {selectedCount} 个项目？不可撤销
              </span>
              <button
                className={styles.bulkDanger}
                type="button"
                data-project-bulk-confirm
                disabled={bulkDeleting}
                onClick={() => void handleBulkDelete()}
              >
                <IconTrash />
                {bulkDeleting ? '收尾中…' : '确认删除'}
              </button>
              <button
                className={styles.bulkBtn}
                type="button"
                disabled={bulkDeleting}
                onClick={() => setBulkConfirm(false)}
              >
                取消
              </button>
            </>
          ) : selectedCount === 0 ? (
            <>
              <button
                className={styles.bulkSelectAll}
                type="button"
                data-project-select-all
                onClick={toggleSelectVisible}
              >
                <IconSelect />
                全选 ({visibleIds.length})
              </button>
              <button className={styles.bulkBtn} type="button" onClick={exitSelection}>
                取消
              </button>
            </>
          ) : (
            <>
              <span className={styles.bulkText}>已选择 {selectedCount} 项</span>
              <button
                className={styles.bulkDanger}
                type="button"
                data-project-bulk-delete
                onClick={() => setBulkConfirm(true)}
              >
                <IconTrash />
                删除
              </button>
              <button
                className={styles.bulkBtn}
                type="button"
                data-project-bulk-clear
                onClick={clearSelected}
              >
                清除
              </button>
              <button
                className={styles.bulkBtn}
                type="button"
                data-project-bulk-cancel
                onClick={exitSelection}
              >
                取消
              </button>
            </>
          )}
        </div>
      )}

      {/* 「+ 新建」的工作台选择浮层（屏幕坐标） */}
      {newMenu && (
        <div className={styles.menuBackdrop} onClick={() => setNewMenu(null)}>
          <div
            className={styles.newMenu}
            style={{ left: newMenu.x, top: newMenu.y }}
            role="menu"
            data-new-workbench-menu
            onClick={(e) => e.stopPropagation()}
          >
            {WORKBENCH_ORDER.map((id) => (
              <button
                key={id}
                className={styles.menuItem}
                role="menuitem"
                data-new-workbench={id}
                onClick={() => createWithWorkbench(id)}
              >
                {WORKBENCHES[id].label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 菜单点击外部关闭的遮罩 */}
      {menuId !== null && <div className={styles.menuBackdrop} onClick={() => setMenuId(null)} />}

      {import.meta.env.MODE === 'development' ? (
        <div className={styles.templateTestBridge} data-dev-template-bridge aria-hidden="true">
          {TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              tabIndex={-1}
              data-template={template.id}
              onClick={() => void createFromTemplate(template.id, template.name)}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
