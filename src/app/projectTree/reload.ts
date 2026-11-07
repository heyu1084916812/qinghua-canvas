export type ProjectTreeLoadDecision = 'load' | 'reset' | 'skip'

/** 路由高亮变化不重新扫项目表；只有打开项目树或项目 revision 变化才加载。 */
export function projectTreeLoadDecision(
  open: boolean,
  revision: number,
  loadedRevision: number | null,
): ProjectTreeLoadDecision {
  if (!open) return 'reset'
  return loadedRevision === revision ? 'skip' : 'load'
}
