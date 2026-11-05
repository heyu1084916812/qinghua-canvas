import type { EcommerceModeOptions } from '../../../domain/ecommerce/types'
import { ProductModeParameters } from './EcommerceStudioModeParametersProduct'
import { MediaAndWearModeParameters } from './EcommerceStudioModeParametersMedia'

export function ModeSpecificParameters(props: {
  modeId: string
  options: EcommerceModeOptions
  setOption: (key: string, value: string | string[] | Record<string, number>) => void
  toggleOption: (key: string, id: string) => void
}) {
  const product = ProductModeParameters(props)
  if (product) return product
  return MediaAndWearModeParameters(props)
}
