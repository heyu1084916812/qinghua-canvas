import {
  dominantHexColors,
  type PaletteColor,
} from '../../../../domain/project/referencePalette'

/**
 * C3：在本机把参考图解码、缩到 48×48 后采样像素，得出主色 HEX（不调任何外部接口）。
 * 浏览器 / WebView 里用 createImageBitmap + OffscreenCanvas；环境不支持或解码失败时返回 null，
 * 调用方照常继续（参考卡只是少一句色值）。
 */

const SAMPLE_SIZE = 48

export type RgbaDecoder = (
  bytes: Uint8Array,
  mime: string,
) => Promise<ArrayLike<number> | null>

export const decodeImageToRgba: RgbaDecoder = async (bytes, mime) => {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') {
    return null
  }
  const bitmap = await createImageBitmap(
    new Blob([bytes as unknown as BlobPart], { type: mime }),
  )
  try {
    const canvas = new OffscreenCanvas(SAMPLE_SIZE, SAMPLE_SIZE)
    const context = canvas.getContext('2d')
    if (!context) return null
    context.drawImage(bitmap, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
    return context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data
  } finally {
    bitmap.close()
  }
}

export async function sampleImagePalette(
  bytes: Uint8Array,
  mime: string,
  decode: RgbaDecoder = decodeImageToRgba,
): Promise<PaletteColor[] | null> {
  try {
    const rgba = await decode(bytes, mime)
    if (!rgba) return null
    const colors = dominantHexColors(rgba)
    return colors.length > 0 ? colors : null
  } catch {
    return null
  }
}
