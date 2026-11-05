/** FlowSurface 右键菜单与节点事件的纯决策。 */
export type FlowMenuTarget = { kind: 'node'; nodeId: string } | { kind: 'canvas' }

export interface ContextMenuPoint {
  x: number
  y: number
  target: FlowMenuTarget
}

export function contextMenuPoint(
  clientX: number,
  clientY: number,
  surface: { x: number; y: number },
  nodeId: string | null,
): ContextMenuPoint {
  return {
    x: clientX - surface.x,
    y: clientY - surface.y,
    target: nodeId ? { kind: 'node', nodeId } : { kind: 'canvas' },
  }
}

export function shouldSelectNodeForMenu(selection: readonly string[], nodeId: string): boolean {
  return !selection.includes(nodeId)
}

export function shouldRouteRun(event: { type: string }): boolean {
  return event.type === 'requestRun'
}

export function shouldRouteCancel(event: { type: string }): boolean {
  return event.type === 'requestRunCancel'
}

export function isEditableKeyboardTarget(target: {
  tagName?: string
  isContentEditable?: boolean
} | null): boolean {
  const tag = target?.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable === true
}

export type DeleteSelectionCommands =
  | { kind: 'node.delete'; ids: string[] }
  | { kind: 'edge.remove'; id: string }[]
  | null

export function deleteSelectionCommands(input: {
  nodeIds: readonly string[]
  edgeIds: readonly string[]
}): DeleteSelectionCommands {
  if (input.nodeIds.length === 0 && input.edgeIds.length === 0) return null
  const commands = input.edgeIds.map((id) => ({ kind: 'edge.remove' as const, id }))
  if (input.nodeIds.length > 0) return { kind: 'node.delete', ids: [...input.nodeIds] }
  return commands
}
