import { CLIPPER_UNCATEGORIZED } from '../../../domain/inspiration/clipper'

export function clipperEmptyTitle(category: string | null): string {
  if (category === CLIPPER_UNCATEGORIZED) return '没有未分类的图片'
  if (category) return `“${category}”还没有图片`
  return '开始收集灵感吧'
}

export function clipperEmptyDescription(category: string | null): string {
  if (category === CLIPPER_UNCATEGORIZED) return '切换到“全部”查看已收藏的网页图片'
  if (category) return '选中图片后可以批量转到这个分类'
  return '在任意网页把图片拖到页面中央，松手后会自动收藏到这里'
}
