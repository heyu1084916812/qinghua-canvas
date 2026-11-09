import { lazy, Suspense, useEffect, useState } from 'react'
import { subscribeContextKitsDialog } from '../state/ui/contextKitsDialog'

const ContextKitsDialog = lazy(() =>
  import('../pages/AssetsPage/ContextKitsDialog').then((module) => ({
    default: module.ContextKitsDialog,
  })),
)

/** 品牌套件弹窗的壳级 lazy 宿主，避免画布页反向依赖素材页内部。 */
export function ContextKitsDialogHost() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const unsubscribe = subscribeContextKitsDialog(() => setOpen(true))
    return unsubscribe
  }, [])

  if (!open) return null
  return (
    <Suspense fallback={null}>
      <ContextKitsDialog onClose={() => setOpen(false)} />
    </Suspense>
  )
}
