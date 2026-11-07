import type { EcommerceRequest } from '../../../domain/ecommerce/types'
import type { NodeInput } from '../../../domain/shared/execution/types'
import type { PlatformKit } from '../../../platform/ports'
import { contextGenerationInputs, type ContextGenerationInputPorts } from '../../../features/shared/context/contextGenerationInputs'
import { createContextRepository } from '../../../state/shared/contextRepository'

export function createPageContextInputPort(
  platform: Pick<PlatformKit, 'storage' | 'assets'>,
  projectId: string,
): (request: EcommerceRequest) => Promise<readonly NodeInput[]> {
  const ports: Omit<ContextGenerationInputPorts, 'request'> = {
    contextRepo: createContextRepository(platform.storage),
    assets: platform.assets,
    projectId,
  }
  return (request) => contextGenerationInputs({
    ...ports,
    request: request.note ?? request.productNodeId,
  })
}
