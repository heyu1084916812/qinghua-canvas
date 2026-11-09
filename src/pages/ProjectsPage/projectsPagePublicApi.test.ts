import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import * as ProjectsPageModule from './ProjectsPage'
import type { ProjectListItem } from '../../domain/project/project'
import { AssetPlatformProvider } from '../../features/shared/assets/AssetPlatformContext'
import { createMemoryPlatform } from '../../platform/memory'

const project: ProjectListItem = {
  id: 'p1',
  name: '兼容快照',
  workbench: 'canvas',
  createdAt: 1,
  updatedAt: Date.now(),
  nodeCount: 4,
}

describe('ProjectsPage public API', () => {
  const withAssetPlatform = (child: React.ReactElement) =>
    createElement(
      AssetPlatformProvider,
      { platform: createMemoryPlatform() },
      child,
    )

  it('保留 ProjectsPage / ProjectCard / HomeEmptyState 三个公开导出', () => {
    expect(ProjectsPageModule.ProjectsPage).toBeTypeOf('function')
    expect(ProjectsPageModule.ProjectCard).toBeTypeOf('function')
    expect(ProjectsPageModule.HomeEmptyState).toBeTypeOf('function')
  })

  it('ProjectCard 保留 DOM 锚点、键盘行为与菜单 / 删除确认按钮顺序', () => {
    const html = renderToStaticMarkup(
      withAssetPlatform(
      createElement(ProjectsPageModule.ProjectCard, {
        project,
        selecting: false,
        selected: false,
        confirming: false,
        deleting: false,
        menuOpen: true,
        renaming: false,
        renameValue: '',
        onOpen: () => {},
        onRenameChange: () => {},
        onRenameCommit: () => {},
        onCancelRename: () => {},
        onRequestDelete: () => {},
        onConfirmDelete: () => {},
        onCancelDelete: () => {},
        onToggleMenu: () => {},
        onCloseMenu: () => {},
        onStartRename: () => {},
        onDuplicate: () => {},
        onExport: () => {},
        onExportWithAssets: () => {},
      }),
      ),
    )
    expect(html).toContain('data-project-card="p1"')
    expect(html).toContain('data-project-workbench="canvas"')
    expect(html).toContain('data-project-name')
    expect(html).toContain('data-project-meta')
    expect(html).toContain('aria-label="项目菜单"')
    expect(html.indexOf('重命名')).toBeLessThan(html.indexOf('复制'))
    expect(html.indexOf('复制')).toBeLessThan(html.indexOf('删除'))
    expect(html.indexOf('导出')).toBeLessThan(html.indexOf('导出（含素材，体积大）'))

    const confirming = renderToStaticMarkup(
      withAssetPlatform(
      createElement(ProjectsPageModule.ProjectCard, {
        project,
        selecting: false,
        selected: false,
        confirming: true,
        deleting: true,
        menuOpen: false,
        renaming: false,
        renameValue: '',
        onOpen: () => {},
        onRenameChange: () => {},
        onRenameCommit: () => {},
        onCancelRename: () => {},
        onRequestDelete: () => {},
        onConfirmDelete: () => {},
        onCancelDelete: () => {},
        onToggleMenu: () => {},
        onCloseMenu: () => {},
        onStartRename: () => {},
        onDuplicate: () => {},
        onExport: () => {},
        onExportWithAssets: () => {},
      }),
      ),
    )
    expect(confirming).toContain('data-project-card-confirm-delete')
    expect(confirming).toContain('收尾中…')
    expect(confirming.match(/disabled=""/g)).toHaveLength(2)
  })

  it('HomeEmptyState 保留空态文案与新建锚点', () => {
    const html = renderToStaticMarkup(
      createElement(ProjectsPageModule.HomeEmptyState, { onCreate: () => {} }),
    )
    expect(html).toContain('还没有项目')
    expect(html).toContain('选择工作区后新建项目。')
    expect(html).toContain('data-new-project')
  })
})
