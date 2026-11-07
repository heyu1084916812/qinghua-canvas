import { errorTextOf } from '../../shared/result'

/** HostingPage 的两处 catch 都要用它，禁止再手写 `String(err)`。 */
export function hostingErrorText(err: unknown): string {
  return errorTextOf(err).slice(0, 120)
}
