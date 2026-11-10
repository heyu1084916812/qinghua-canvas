import type { NetworkPort } from '../../../platform/ports'
import { validateClipperImage } from './clipperImageValidation'

export async function validateClipperImageCandidates(input: {
  pageUrl: string
  imageUrls: readonly string[]
  network: NetworkPort
  signal: AbortSignal
}): Promise<{ validUrls: Set<string>; warnings: string[] }> {
  const imageUrls = [...new Set(input.imageUrls)]
  const checks = await Promise.allSettled(imageUrls.map((imageUrl) =>
    validateClipperImage({ ...input, imageUrl }),
  ))
  const validUrls = new Set<string>()
  const warnings: string[] = []
  checks.forEach((check, index) => {
    if (check.status === 'fulfilled') {
      validUrls.add(imageUrls[index]!)
      return
    }
    const message = check.reason instanceof Error
      ? check.reason.message
      : String(check.reason)
    if (!warnings.includes(message)) warnings.push(message)
  })
  return { validUrls, warnings }
}
