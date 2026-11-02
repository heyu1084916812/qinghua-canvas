import type { DirectRunRouteCandidate } from '../../../../state/shared/directRun'
import type { RoutedChatTarget } from '../../../../domain/shared/chatTarget'

export interface AgentChatRoute extends RoutedChatTarget {
  credentialGroupId?: string
  routePlanId: string
  candidates: DirectRunRouteCandidate[]
}

export type ChatRoutePreparation =
  | { ok: true; route: AgentChatRoute }
  | { ok: false; message: string }
