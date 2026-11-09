import { describe, expect, it } from 'vitest'

const sources = {
  ...import.meta.glob('../**/*.{ts,tsx}', {
    eager: true,
    query: '?raw',
    import: 'default',
  }),
  ...import.meta.glob('./*.{ts,tsx}', {
    eager: true,
    query: '?raw',
    import: 'default',
  }),
} as Record<string, string>
const pick = <T>(table: Record<string, T>, relative: string) =>
  table[`../${relative}`] ?? table[`./${relative.replace(/^app\//, '')}`]
const read = (relative: string) => {
  const source = pick<string>(sources, relative)
  if (!source) throw new Error(`missing source: ${relative}`)
  return source
}
describe('seven UI placement fixes', () => {
  it('moves brand kits and defaults to the canvas workspace left corner', () => {
    const canvas = read('pages/CanvasPage/CanvasPage.tsx')
    const assets = read('pages/AssetsPage/AssetsPage.tsx')
    const shell = read('app/AppShell.tsx')
    expect(canvas).toContain('data-canvas-context-kits')
    expect(canvas).toContain('data-canvas-defaults')
    expect(canvas).toContain('onClick={openContextKitsDialog}')
    expect(canvas).not.toContain('AssetsPage/ContextKitsDialog')
    expect(canvas).toContain('styles.topLeftActions')
    expect(assets).not.toContain('data-assets-context-kits-open')
    expect(assets).not.toContain('ContextKitsDialogLazy')
    expect(shell).toContain('<ContextKitsDialogHost />')
  })

  it('asks which workbench to create before creating a project', () => {
    const home = read('pages/HomePage/HomePage.tsx')
    const projects = read('pages/ProjectsPage/ProjectsPage.tsx')
    const shell = read('app/AppShell.tsx')
    const host = read('features/shared/project/NewProjectChoiceHost.tsx')
    expect(home).toContain('requestNewProjectChoice')
    expect(home).not.toContain("workbench: 'canvas'")
    expect(projects).toContain('requestNewProjectChoice')
    expect(shell).toContain('<NewProjectChoiceHost />')
    expect(host).toContain('create({ workbench })')
  })

  it('keeps Canvas MCP as its own connection setting, not an Agent advanced tab', () => {
    const settings = read('state/ui/globalSettings.ts')
    const overlay = read('app/GlobalSettingsOverlay.tsx')
    const agent = read('features/settings/AgentSettingsPanel.tsx')
    const icons = read('app/SettingsIcons.tsx')
    expect(settings).toContain("id: 'canvasMcp'")
    expect(overlay).toContain("section === 'canvasMcp' && <CanvasMcpPanel")
    expect(overlay).toContain('canvasMcp: IconMcpLink')
    expect(icons).toContain('export function IconMcpLink')
    expect(agent).not.toContain('<CanvasMcpPanel />')
  })

  it('keeps default parameters reachable from canvas without a duplicate nav row', () => {
    const settings = read('state/ui/globalSettings.ts')
    const overlay = read('app/GlobalSettingsOverlay.tsx')
    const defaults = read('features/settings/DefaultParamsPanel.tsx')
    expect(settings).not.toContain("id: 'defaults'")
    expect(settings).toContain("| 'defaults'")
    expect(overlay).toContain("section === 'defaults' && <DefaultParamsPanel")
    expect(defaults).toContain('画布新节点使用这里的配方')
    expect(defaults).toContain('电商与漫剧生成也读取同一份默认模型设置')
  })

  it('prunes snapshots and renders only the retained set', () => {
    const panel = read('features/settings/SnapshotsPanel.tsx')
    const store = read('state/project/snapshotStore.ts')
    expect(panel).toContain('snapshotStore.pruneAll(SNAPSHOT_KEEP_DEFAULT)')
    expect(panel).not.toContain('snapshots.slice(0, 20)')
    expect(panel).toContain('已清理 ${removed} 份多余快照')
    expect(store).toContain('await prune(projectId, SNAPSHOT_KEEP_DEFAULT)')
    expect(store).toContain('await pruneAll(keep)')
    expect(store).toContain('pruneAll')
  })

  it('sanitizes CLI output and contains Agent panel overflow', () => {
    const cli = read('features/settings/CliPanel.tsx')
    const cliText = read('features/settings/cliOutputText.ts')
    expect(cli).toContain('readableCliOutput')
    expect(cli).toContain('hasReadableCliOutput')
    expect(cliText).toContain('CSI_OR_OSC')
    expect(read('app/GlobalSettingsOverlay.tsx')).toContain('data-settings-section-body')
  })
})
