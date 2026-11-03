import type { TaskShutdownControl } from '../features/shared/lifecycle/taskLifecycle'

interface ProjectRuntimeRegistration {
  key: string
  projectId: string
  generation: number
  active: boolean
  beginDispose: () => TaskShutdownControl
}

export interface ProjectRuntimeRegistrationHandle {
  key: string
  projectId: string
  generation: number
}

interface PreparedRuntime {
  project: Map<string, ProjectRuntimeRegistration>
  key: string
  runtime: ProjectRuntimeRegistration
  control: TaskShutdownControl
}

export interface ProjectRuntimeDisposal {
  /** 数据库操作失败时恢复仍保留的全部 runtime / host。 */
  rollback(): boolean
  /** 数据库成功后提交清理；调用前不能 purge / 移出 UI。 */
  commit(): boolean
}

const registrations = new Map<
  string,
  Map<string, ProjectRuntimeRegistration>
>()
let nextGeneration = 1

function controlsOf(
  prepared: readonly PreparedRuntime[],
): TaskShutdownControl[] {
  return prepared.map((item) => item.control)
}

function recoverPrepared(prepared: readonly PreparedRuntime[]): boolean {
  const controls = controlsOf(prepared)
  if (controls.every((control) => control.canReopen())) {
    return controls.every((control) => control.reopenIfIdle())
  }
  void Promise.allSettled(
    controls.map((control) => control.whenIdle()),
  ).then(() => {
    if (controls.every((control) => control.canReopen())) {
      controls.forEach((control) => control.reopenIfIdle())
    }
  })
  return false
}

/**
 * 每项目运行时清理入口。
 *
 * 注册本身不随 React effect cleanup 撤销：StrictMode 的模拟卸载只能
 * deactivate host，不能提前 dispose。真正删除 / HMR 由显式调用触发。
 */
export function registerProjectRuntime(
  input: Omit<ProjectRuntimeRegistration, 'generation' | 'active'>,
): ProjectRuntimeRegistrationHandle {
  const registration: ProjectRuntimeRegistration = {
    ...input,
    generation: nextGeneration++,
    active: true,
  }
  let project = registrations.get(input.projectId)
  if (!project) {
    project = new Map()
    registrations.set(input.projectId, project)
  }
  project.set(input.key, registration)
  return {
    key: registration.key,
    projectId: registration.projectId,
    generation: registration.generation,
  }
}

/**
 * 两阶段关闭：先同步阻断新工作并等待 idle，数据库成功后才 commit。
 *
 * 失败时立即恢复 idle participant；仍有在途 Promise 的 participant 会在
 * 真正 idle 后恢复，绝不在未 idle 时假装重开，也不提前 purge。
 */
export async function prepareProjectRuntimes(
  projectIds: readonly string[],
): Promise<ProjectRuntimeDisposal> {
  const prepared: PreparedRuntime[] = []
  try {
    for (const projectId of [...new Set(projectIds)]) {
      const project = registrations.get(projectId)
      if (!project) continue
      for (const [key, runtime] of [...project.entries()]) {
        runtime.active = false
        prepared.push({
          project,
          key,
          runtime,
          control: runtime.beginDispose(),
        })
      }
    }
  } catch (error) {
    recoverPrepared(prepared)
    throw error
  }

  let committed = false
  const disposal: ProjectRuntimeDisposal = {
    rollback() {
      if (committed) return false
      return recoverPrepared(prepared)
    },
    commit() {
      if (committed) return false
      const controls = controlsOf(prepared)
      if (!controls.every((control) => control.canFinalize())) {
        return false
      }
      if (!controls.every((control) => control.finalize())) {
        return false
      }
      committed = true
      for (const { project, key, runtime } of prepared) {
        if (project.get(key) === runtime) project.delete(key)
      }
      for (const projectId of [...new Set(projectIds)]) {
        if (registrations.get(projectId)?.size === 0) {
          registrations.delete(projectId)
        }
      }
      return true
    },
  }

  try {
    await Promise.all(
      prepared.map((item) => item.control.waitForIdle()),
    )
  } catch (error) {
    recoverPrepared(prepared)
    throw error
  }
  return disposal
}

export async function withPreparedProjectRuntimes<T>(
  projectIds: readonly string[],
  work: () => Promise<T>,
): Promise<T> {
  const disposal = await prepareProjectRuntimes(projectIds)
  try {
    const result = await work()
    if (!disposal.commit()) {
      throw new Error('项目运行时未能安全提交清理')
    }
    return result
  } catch (error) {
    disposal.rollback()
    throw error
  }
}

export async function disposeProjectRuntimes(
  projectIds: readonly string[],
): Promise<void> {
  const disposal = await prepareProjectRuntimes(projectIds)
  if (!disposal.commit()) {
    throw new Error('项目运行时未能安全完成清理')
  }
}

export async function disposeAllProjectRuntimes(): Promise<void> {
  await disposeProjectRuntimes([...registrations.keys()])
}

export function resetProjectRuntimesForTests(): void {
  registrations.clear()
  nextGeneration = 1
}
