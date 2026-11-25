export function rectStyle(
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
): Record<string, string> {
  return {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  }
}

export function centerAnchoredFlipTransform(
  from: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  to: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
): string {
  const dx = from.left + from.width / 2 - (to.left + to.width / 2)
  const dy = from.top + from.height / 2 - (to.top + to.height / 2)
  const sx = to.width > 0 ? from.width / to.width : 1
  const sy = to.height > 0 ? from.height / to.height : 1
  return `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`
}

export function resolveEntryTargetRect(
  measured: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'> | null,
  predicted: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'> | null,
  targetMounted: boolean,
): Pick<DOMRect, 'left' | 'top' | 'width' | 'height'> | null {
  return measured ?? (targetMounted ? null : predicted)
}

export function lightboxEntryFrames(
  from: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  to: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  sourceRadius: string,
  targetRadius: string,
  sourceShadow: string,
  targetShadow: string,
) {
  const transform = centerAnchoredFlipTransform(from, to)
  return [
    { transform, borderRadius: sourceRadius, boxShadow: sourceShadow, opacity: '1' },
    {
      transform: 'translate(0px, 0px) scale(1, 1)',
      borderRadius: targetRadius,
      boxShadow: targetShadow,
      opacity: '1',
    },
  ] as Keyframe[]
}

export function lightboxExitFrames(
  current: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  destination: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  currentRadius: string,
  destinationRadius: string,
  currentShadow: string,
  destinationShadow: string,
) {
  return [
    { transform: 'none', borderRadius: currentRadius, boxShadow: currentShadow, opacity: '1' },
    {
      transform: centerAnchoredFlipTransform(destination, current),
      borderRadius: destinationRadius,
      boxShadow: destinationShadow,
      opacity: '1',
    },
  ] as Keyframe[]
}

export function flipClone(
  source: HTMLElement,
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  borderRadius: string,
  boxShadow: string,
): HTMLElement {
  const clone = source.cloneNode(true) as HTMLElement
  const objectFit = getComputedStyle(source).objectFit || 'cover'
  clone.removeAttribute('data-node-asset')
  clone.setAttribute('data-lightbox-flip-clone', '')
  Object.assign(clone.style, {
    position: 'fixed',
    zIndex: '9999',
    margin: '0',
    pointerEvents: 'none',
    objectFit,
    transform: 'none',
    opacity: '1',
    transformOrigin: 'center center',
    willChange: 'transform, border-radius, box-shadow, opacity',
    ...rectStyle(rect),
    borderRadius,
    boxShadow,
  })
  return clone
}
