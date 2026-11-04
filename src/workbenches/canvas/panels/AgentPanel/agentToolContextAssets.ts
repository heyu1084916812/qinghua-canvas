/**
 * 送进生成节点的上下文素材**只收图片**。
 *
 * `runNodes`（跑这一轮节点用的素材）与 `contextAssetsForGenerated`（新建生成节点时写进
 * `GenerationData.contextAssets` 的套件素材）必须是**同一条规则**：两处各写一遍就会出现
 * 「跑的时候带了图、建节点时却不带」这种没人报得出来的哑分歧。
 *
 * 未知 MIME 一律丢弃，不做「看着像图就放行」的猜测。
 */
export function imageContextAssets<T extends { mime: string }>(
  assets: readonly T[] | null | undefined,
): T[] {
  return (assets ?? []).filter((asset) => asset.mime.startsWith('image/'))
}
