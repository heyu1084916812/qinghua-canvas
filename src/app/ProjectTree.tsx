import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import {
  WORKBENCH_ORDER,
  projectRoute,
  type WorkbenchId,
} from '../domain/shared/workbench'
import type {
  ProjectFolder,
  ProjectListItem,
} from '../domain/project/project'
import { createProjectRepository } from '../state/project/repository'
import { buildProjectExport } from '../state/project/flowIo'
import { forgetActiveWorkbench } from '../state/project/activeCanvas'
import {
  getProjectsRevision,
  subscribeProjectsChanged,
} from '../state/project/projectEvents'
import { projectMenuPosition, type ProjectMenuFrame } from './projectMenuPosition'
import {
  getProjectRuntimePendingSnapshot,
  subscribeProjectRuntimePending,
} from './ProjectRuntimeRegistry'
import { usePlatform } from './providers/PlatformProvider'
import {
  IconChevron,
  IconCopy,
  IconFolderOut,
  IconPin,
  IconPlus,
  IconRename,
  IconReveal,
  IconTrash,
  IconUpload,
  IconCloseCanvas,
  IconMove,
} from './ProjectTreeIcons'
import styles from './ProjectTree.module.css'
import {
  GroupExpandButton,
  GroupRow,
  MenuButton,
  ModalLayer,
  ProjectDeleteConfirmActions,
  ProjectRow,
  WorkbenchIcon,
} from './projectTree/ProjectTreeViews'
import {
  createProjectTreePathActions,
  type ProjectTreePathStatus,
} from './projectTree/treePathActions'
import {
  createProjectTreeMutationActions,
  type ProjectTreeConfirmTarget,
} from './projectTree/treeMutationActions'
import { projectTreeProjection, toggleGroupId } from './projectTree/treeProjection'
import { projectTreeLoadDecision } from './projectTree/reload'

export { ProjectDeleteConfirmActions } from './projectTree/ProjectTreeViews'

type MenuTarget =
  | {
      kind: 'folder'
      id: string
      anchor: DOMRect
    }
  | {
      kind: 'project'
      id: string
      anchor: DOMRect
    }

interface RenameTarget {
  kind: 'folder' | 'project'
  id: string
  value: string
}

interface ProjectTreeProps {
  open: boolean
  activeProjectId: string | null
}

const SHORT_WORKBENCH_LABEL: Record<WorkbenchId, string> = {
  canvas: '画布',
  ecommerce: '电商',
  storyboard: '漫剧',
}

/**
 * 侧栏「所有项目」树。
 *
 * 项目与文件夹的可见变更走 `projectEvents`，因此重命名、置顶、移动后不需要切页；
 * 菜单与确认框使用 portal，避免被侧栏的滚动容器裁切。
 */
export function ProjectTree({ open, activeProjectId }: ProjectTreeProps) {
  const platform = usePlatform()
  const navigate = useNavigate()
  const repo = useMemo(
    () => createProjectRepository(platform.storage),
    [platform.storage],
  )
  const revision = useSyncExternalStore(
    subscribeProjectsChanged,
    getProjectsRevision,
    getProjectsRevision,
  )
  const [projects, setProjects] = useState<ProjectListItem[]>([])
  const [folders, setFolders] = useState<ProjectFolder[]>([])
  const [loading, setLoading] = useState(false)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const [menu, setMenu] = useState<MenuTarget | null>(null)
  const [menuFrame, setMenuFrame] = useState<ProjectMenuFrame | null>(null)
  const [moveMenuOpen, setMoveMenuOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<ProjectTreeConfirmTarget | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [cleanupOperationId, setCleanupOperationId] =
    useState<number | null>(null)
  const [status, setStatus] = useState<ProjectTreePathStatus | null>(null)
  const pendingRuntimeOperations = useSyncExternalStore(
    subscribeProjectRuntimePending,
    getProjectRuntimePendingSnapshot,
    getProjectRuntimePendingSnapshot,
  )
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
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const loadedRevisionRef = useRef<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      await platform.storage.open()
      const [nextProjects, nextFolders] = await Promise.all([
        repo.list(),
        repo.listFolders(),
      ])
      setProjects(nextProjects)
      setFolders(nextFolders)
    } catch (error) {
      loadedRevisionRef.current = null
      setStatus({
        text: `项目树读取失败：${error instanceof Error ? error.message : String(error)}`,
        tone: 'error',
      })
    } finally {
      setLoading(false)
    }
  }, [platform.storage, repo])

  useEffect(() => {
    const decision = projectTreeLoadDecision(open, revision, loadedRevisionRef.current)
    loadedRevisionRef.current =
      decision === 'reset' ? null : decision === 'load' ? revision : loadedRevisionRef.current
    if (decision === 'load') void load()
  }, [load, open, revision])

  useEffect(() => {
    if (!renameTarget) return
    const frame = window.requestAnimationFrame(() => {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [renameTarget])

  useEffect(() => {
    if (!menu && !renameTarget && !confirmTarget) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (deleteBusy) return
      setMenu(null)
      setRenameTarget(null)
      setConfirmTarget(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [confirmTarget, deleteBusy, menu, renameTarget])

  const projection = useMemo(
    () => projectTreeProjection(projects, folders, activeProjectId, expandedGroups),
    [activeProjectId, expandedGroups, folders, projects],
  )
  const { tree, pinnedWindow, groupWindow, folderTotal: totalInFolder } = projection

  const toggleGroup = (id: string) =>
    setCollapsed((current) => toggleGroupId(current, id))

  const toggleExpandedGroup = (id: string) =>
    setExpandedGroups((current) => toggleGroupId(current, id))

  const pathActions = useMemo(
    () =>
      createProjectTreePathActions({
        platform,
        clipboard: navigator.clipboard,
        exportProject: buildProjectExport,
        onStatus: setStatus,
      }),
    [platform],
  )

  const mutations = useMemo(
    () =>
      createProjectTreeMutationActions({
        repo,
        projects,
        navigate,
        projectRoute,
        status: setStatus,
        clearMenu: () => setMenu(null),
        setRenameTarget,
        setConfirmTarget,
        setCleanupOperationId,
        busy: () => deleteBusy,
        setBusy: setDeleteBusy,
        load,
      }),
    [
      deleteBusy,
      load,
      navigate,
      projects,
      repo,
      setCleanupOperationId,
      setConfirmTarget,
      setRenameTarget,
      setDeleteBusy,
      setMenu,
      setStatus,
    ],
  )

  const showMenu = (
    target: { kind: 'folder'; id: string } | { kind: 'project'; id: string },
    button: HTMLButtonElement,
  ) => {
    setMoveMenuOpen(false)
    setMenuFrame(null)
    setMenu({ ...target, anchor: button.getBoundingClientRect() })
  }

  useLayoutEffect(() => {
    const node = menuRef.current
    if (!menu || !node) return
    const next = projectMenuPosition(menu.anchor, node.scrollHeight, {
      width: window.innerWidth,
      height: window.innerHeight,
    })
    setMenuFrame((current) =>
      current &&
      current.left === next.left &&
      current.top === next.top &&
      current.maxHeight === next.maxHeight
        ? current
        : next,
    )
  }, [menu, moveMenuOpen])

  const startRename = (kind: 'folder' | 'project', id: string, value: string) => {
    setMenu(null)
    setRenameTarget({ kind, id, value })
  }

  const runPathAction = (action: Promise<ProjectTreePathStatus>) => {
    setMenu(null)
    void action.then((next) => {
      if (next.text) setStatus(next)
    })
  }

  const submitRename = () => void mutations.submitRename(renameTarget)
  const createFolder = () => void mutations.createFolder()
  const createProject = (workbench: WorkbenchId, folderId?: string) =>
    void mutations.createProject(workbench, folderId)
  const moveProject = (projectId: string, folderId: string | null) =>
    void mutations.moveProject(projectId, folderId)
  const moveAllOut = (folderId: string) => void mutations.moveAllOut(folderId)
  const copyProjectPath = (project: ProjectListItem) =>
    runPathAction(pathActions.copyProjectPath(project))
  const copyFolderPath = (folder: ProjectFolder) =>
    runPathAction(pathActions.copyFolderPath(folder))
  const revealProject = () => runPathAction(pathActions.revealProject())
  const uploadProject = (project: ProjectListItem) =>
    runPathAction(pathActions.uploadProject(project))
  const uploadFolder = (folder: ProjectFolder) =>
    runPathAction(pathActions.uploadFolder(folder, projects))
  const askDelete = (target: ProjectTreeConfirmTarget) => mutations.askDelete(target)
  const confirmDelete = () => void mutations.confirmDelete(confirmTarget)
  const retryRuntimeCleanup = () =>
    void mutations.retryRuntimeCleanup(cleanupPending?.projectIds ?? [])

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
    setStatus({
      text: '项目运行态清理完成',
      tone: 'info',
    })
  }, [
    cleanupOperationId,
    pendingRuntimeOperations,
  ])

  const menuProject =
    menu?.kind === 'project'
      ? projects.find((project) => project.id === menu.id) ?? null
      : null
  const menuFolder =
    menu?.kind === 'folder'
      ? folders.find((folder) => folder.id === menu.id) ?? null
      : null

  return (
    <section className={styles.root} data-sidebar-project-tree data-sidebar-text>
      <div className={styles.heading}>
        <span className={styles.headingText}>所有项目</span>
        <button
          type="button"
          className={styles.headingAction}
          title="新建文件夹"
          aria-label="新建文件夹"
          data-project-tree-new-folder
          onClick={() => void createFolder()}
        >
          <IconPlus size={15} />
        </button>
      </div>

      <div className={styles.scroll}>
        {loading && projects.length === 0 ? (
          <div className={styles.skeletons} aria-label="正在读取项目">
            <span />
            <span />
            <span />
          </div>
        ) : projects.length === 0 && folders.length === 0 ? (
          <div className={styles.empty}>还没有项目</div>
        ) : (
          <>
            {tree.pinnedProjects.length > 0 && (
              <div className={styles.section} data-project-tree-group-id="pinned">
                <div className={styles.sectionLabel}>置顶</div>
                <ul className={styles.list}>
                  {pinnedWindow.visible.map((project) => (
                    <ProjectRow
                      key={project.id}
                      project={project}
                      active={project.id === activeProjectId}
                      onOpen={() => navigate(projectRoute(project.workbench, project.id))}
                      onTogglePin={() => void repo.setProjectPinned(project.id, false)}
                      onMore={(button) => showMenu({ kind: 'project', id: project.id }, button)}
                    />
                  ))}
                </ul>
                {pinnedWindow.hidden > 0 && (
                  <GroupExpandButton
                    count={pinnedWindow.hidden}
                    expanded={pinnedWindow.expanded}
                    groupId="pinned"
                    onToggle={toggleExpandedGroup}
                  />
                )}
              </div>
            )}

            {tree.folders.map(({ folder, projects: folderProjects }) => {
              const groupId = `folder:${folder.id}`
              const isCollapsed = collapsed.has(groupId)
              const window = groupWindow(folderProjects, groupId)
              const total = totalInFolder(folder.id)
              return (
                <div
                  className={styles.section}
                  key={folder.id}
                  data-project-tree-group-id={groupId}
                >
                  <GroupRow
                    label={folder.name}
                    count={total}
                    pinned={(folder.pinnedAt ?? 0) > 0}
                    collapsed={isCollapsed}
                    onToggle={() => toggleGroup(groupId)}
                    onTogglePin={() => void repo.setFolderPinned(folder.id, !folder.pinnedAt)}
                    onMore={(button) => showMenu({ kind: 'folder', id: folder.id }, button)}
                  />
                  {!isCollapsed && (
                    <ul className={styles.list}>
                      {folderProjects.length === 0 ? (
                        <li className={styles.groupEmpty}>文件夹为空</li>
                      ) : (
                        window.visible.map((project) => (
                          <ProjectRow
                            key={project.id}
                            project={project}
                            active={project.id === activeProjectId}
                            onOpen={() => navigate(projectRoute(project.workbench, project.id))}
                            onTogglePin={() => void repo.setProjectPinned(project.id, true)}
                            onMore={(button) =>
                              showMenu({ kind: 'project', id: project.id }, button)
                            }
                          />
                        ))
                      )}
                    </ul>
                  )}
                  {!isCollapsed && window.hidden > 0 && (
                    <GroupExpandButton
                      count={window.hidden}
                      expanded={window.expanded}
                      groupId={groupId}
                      onToggle={toggleExpandedGroup}
                    />
                  )}
                </div>
              )
            })}

            {tree.unfiled.map(({ workbench, label, projects: groupProjects }) => {
              const groupId = `workbench:${workbench}`
              const isCollapsed = collapsed.has(groupId)
              const window = groupWindow(groupProjects, groupId)
              return (
                <div
                  className={styles.section}
                  key={workbench}
                  data-project-tree-group-id={groupId}
                >
                  <GroupRow
                    label={label}
                    count={groupProjects.length}
                    pinned={false}
                    collapsed={isCollapsed}
                    onToggle={() => toggleGroup(groupId)}
                    onTogglePin={undefined}
                    onMore={undefined}
                  />
                  {!isCollapsed && (
                    <ul className={styles.list}>
                      {groupProjects.length === 0 ? (
                        <li className={styles.groupEmpty}>暂无项目</li>
                      ) : (
                        window.visible.map((project) => (
                          <ProjectRow
                            key={project.id}
                            project={project}
                            active={project.id === activeProjectId}
                            onOpen={() => navigate(projectRoute(project.workbench, project.id))}
                            onTogglePin={() => void repo.setProjectPinned(project.id, true)}
                            onMore={(button) =>
                              showMenu({ kind: 'project', id: project.id }, button)
                            }
                          />
                        ))
                      )}
                    </ul>
                  )}
                  {!isCollapsed && window.hidden > 0 && (
                    <GroupExpandButton
                      count={window.hidden}
                      expanded={window.expanded}
                      groupId={groupId}
                      onToggle={toggleExpandedGroup}
                    />
                  )}
                </div>
              )
            })}
          </>
        )}
      </div>

      {status && (
        <div
          className={
            status.tone === 'error'
              ? `${styles.status} ${styles.statusError}`
              : styles.status
          }
          role={status.tone === 'error' ? 'alert' : 'status'}
        >
          {status.text}
          {(cleanupPending || cleanupCommitting) && (
            <button
              type="button"
              className={styles.statusRetry}
              data-project-tree-cleanup-retry
              disabled={!cleanupPending || deleteBusy || cleanupCommitting}
              onClick={() => void retryRuntimeCleanup()}
            >
              {cleanupCommitting || deleteBusy ? '清理中…' : '重试清理'}
            </button>
          )}
        </div>
      )}

      {menu &&
        createPortal(
          <div className={styles.menuLayer} onPointerDown={() => setMenu(null)}>
            <div
              ref={menuRef}
              className={styles.menu}
              role="menu"
              data-project-menu
              style={
                menuFrame
                  ? menuFrame
                  : {
                      left: menu.anchor.left,
                      top: menu.anchor.bottom + 4,
                      maxHeight: Math.max(1, window.innerHeight - menu.anchor.bottom - 12),
                      visibility: 'hidden',
                    }
              }
              onPointerDown={(event) => event.stopPropagation()}
            >
              {menu.kind === 'folder' && menuFolder && (
                <>
                  <MenuButton
                    icon={<IconRename />}
                    label="重命名"
                    onClick={() => startRename('folder', menuFolder.id, menuFolder.name)}
                  />
                  <MenuButton
                    icon={<IconPin />}
                    label={menuFolder.pinnedAt ? '取消置顶' : '置顶'}
                    onClick={() => {
                      setMenu(null)
                      void repo.setFolderPinned(menuFolder.id, !menuFolder.pinnedAt)
                    }}
                  />
                  <div className={styles.menuDivider} />
                  {WORKBENCH_ORDER.map((workbench) => (
                    <MenuButton
                      key={workbench}
                      icon={<WorkbenchIcon workbench={workbench} />}
                      label={`新建${SHORT_WORKBENCH_LABEL[workbench]}`}
                      onClick={() => void createProject(workbench, menuFolder.id)}
                    />
                  ))}
                  <MenuButton
                    icon={<IconChevron size={16} />}
                    label={collapsed.has(`folder:${menuFolder.id}`) ? '展开文件夹' : '收起文件夹'}
                    onClick={() => {
                      setMenu(null)
                      toggleGroup(`folder:${menuFolder.id}`)
                    }}
                  />
                  <div className={styles.menuDivider} />
                  <MenuButton
                    icon={<IconFolderOut />}
                    label="移出全部项目"
                    onClick={() => void moveAllOut(menuFolder.id)}
                  />
                  <div className={styles.menuDivider} />
                  <MenuButton
                    icon={<IconCopy />}
                    label="复制路径"
                    onClick={() => void copyFolderPath(menuFolder)}
                  />
                  <MenuButton
                    icon={<IconReveal />}
                    label="在文件资源管理器中打开"
                    onClick={() => void revealProject()}
                  />
                  <MenuButton
                    icon={<IconUpload />}
                    label="上传文件夹到 OSS"
                    onClick={() => void uploadFolder(menuFolder)}
                  />
                  <div className={styles.menuDivider} />
                  <MenuButton
                    danger
                    icon={<IconTrash />}
                    label="删除文件夹"
                    onClick={() =>
                      askDelete({ kind: 'folder', id: menuFolder.id, name: menuFolder.name })
                    }
                  />
                </>
              )}

              {menu.kind === 'project' && menuProject && (
                <>
                  <MenuButton
                    icon={<IconRename />}
                    label="重命名"
                    onClick={() => startRename('project', menuProject.id, menuProject.name)}
                  />
                  <MenuButton
                    icon={<IconMove />}
                    label="移入项目"
                    trailing="›"
                    onClick={() => setMoveMenuOpen((value) => !value)}
                  />
                  {moveMenuOpen && (
                    <div className={styles.submenu}>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => void moveProject(menuProject.id, null)}
                      >
                        未归档
                      </button>
                      {folders.map((folder) => (
                        <button
                          key={folder.id}
                          type="button"
                          role="menuitem"
                          onClick={() => void moveProject(menuProject.id, folder.id)}
                        >
                          {folder.name}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className={styles.menuDivider} />
                  <MenuButton
                    icon={<IconCopy />}
                    label="复制路径"
                    onClick={() => void copyProjectPath(menuProject)}
                  />
                  <MenuButton
                    icon={<IconReveal />}
                    label="在文件资源管理器中打开"
                    onClick={() => void revealProject()}
                  />
                  <MenuButton
                    icon={<IconUpload />}
                    label="上传到 OSS"
                    onClick={() => void uploadProject(menuProject)}
                  />
                  <MenuButton
                    icon={<IconCloseCanvas />}
                    label="关闭项目"
                    disabled={menuProject.id !== activeProjectId}
                    onClick={() => {
                      setMenu(null)
                      forgetActiveWorkbench(menuProject.workbench)
                      navigate('/projects')
                    }}
                  />
                  <div className={styles.menuDivider} />
                  <MenuButton
                    icon={<IconPin />}
                    label={menuProject.pinnedAt ? '取消置顶' : '置顶'}
                    onClick={() => {
                      setMenu(null)
                      void repo.setProjectPinned(menuProject.id, !menuProject.pinnedAt)
                    }}
                  />
                  <MenuButton
                    danger
                    icon={<IconTrash />}
                    label="删除"
                    onClick={() =>
                      askDelete({
                        kind: 'project',
                        id: menuProject.id,
                        name: menuProject.name,
                      })
                    }
                  />
                </>
              )}
            </div>
          </div>,
          document.body,
        )}

      {renameTarget &&
        createPortal(
          <ModalLayer onClose={() => setRenameTarget(null)}>
            <form
              className={styles.dialog}
              role="dialog"
              aria-modal="true"
              aria-labelledby="project-tree-rename-title"
              onSubmit={(event) => {
                event.preventDefault()
                void submitRename()
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setRenameTarget(null)
              }}
            >
              <h2 id="project-tree-rename-title">
                {renameTarget.kind === 'folder' ? '重命名文件夹' : '重命名画布'}
              </h2>
              <label className={styles.dialogLabel}>
                <span>{renameTarget.kind === 'folder' ? '文件夹名称' : '画布名称'}</span>
                <input
                  ref={renameInputRef}
                  value={renameTarget.value}
                  onChange={(event) =>
                    setRenameTarget((current) =>
                      current ? { ...current, value: event.target.value } : current,
                    )
                  }
                />
              </label>
              <div className={styles.dialogActions}>
                <button type="button" onClick={() => setRenameTarget(null)}>
                  取消
                </button>
                <button
                  type="submit"
                  className={styles.primaryButton}
                  disabled={!renameTarget.value.trim()}
                >
                  保存
                </button>
              </div>
            </form>
          </ModalLayer>,
          document.body,
        )}

      {confirmTarget &&
        createPortal(
          <ModalLayer
            onClose={() => {
              if (!deleteBusy) setConfirmTarget(null)
            }}
          >
            <div
              className={styles.dialog}
              role="alertdialog"
              aria-modal="true"
              aria-busy={deleteBusy || undefined}
              aria-labelledby="project-tree-confirm-title"
            >
              <h2 id="project-tree-confirm-title">
                {confirmTarget.kind === 'folder' ? '删除文件夹？' : '删除项目？'}
              </h2>
              <p>
                {confirmTarget.kind === 'folder'
                  ? `「${confirmTarget.name}」里的项目会移到未分组，不会被删除。`
                  : `「${confirmTarget.name}」会移到回收站，可在项目页恢复。`}
              </p>
              <div className={styles.dialogActions}>
                <ProjectDeleteConfirmActions
                  deleting={deleteBusy}
                  onCancel={() => setConfirmTarget(null)}
                  onConfirm={() => void confirmDelete()}
                />
              </div>
            </div>
          </ModalLayer>,
          document.body,
        )}
    </section>
  )
}
