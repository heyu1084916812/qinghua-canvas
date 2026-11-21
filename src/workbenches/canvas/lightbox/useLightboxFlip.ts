import { useLightboxFlipController } from './lightboxFlipController'

/** Stable lightbox entry point; the imperative FLIP controller lives in its own module. */
export function useLightboxFlip(props: Parameters<typeof useLightboxFlipController>[0]) {
  return useLightboxFlipController(props)
}
