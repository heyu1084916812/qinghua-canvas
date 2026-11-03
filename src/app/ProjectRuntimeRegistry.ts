interface ProjectRuntimeRegistration {
  key: string
  projectId: string
  dispose: () => Promise<void>
}

const registrations = new Map<
  string,
  Map<string, ProjectRuntimeRegistration>
>()

/**
 * 每项目运行时清理入口。
 *
 * 注册本身不随 React effect cleanup 撤销：StrictMode 的模拟卸载只能
 * deactivate host，不能提前 dispose。真正删除 / HMR 由显式调用触发。
 */
export function registerProjectRuntime(
  input: ProjectRuntimeRegistration,
): void {
  let project = registrations.get(input.projectId)
  if (!project) {
    project = new Map()
    registrations.set(input.projectId, project)
  }
  project.set(input.key, input)
}

export async function disposeProjectRuntimes(
  projectIds: readonly string[],
): Promise<void> {
  let firstError: unknown
  for (const projectId of [...new Set(projectIds)]) {
    const project = registrations.get(projectId)
    if (!project) continue
    for (const [key, runtime] of project) {
      try {
        await runtime.dispose()
        project.delete(key)
      } catch (error) {
        firstError ??= error
      }
    }
    if (project.size === 0) registrations.delete(projectId)
  }
  if (firstError) throw firstError
}

export async function disposeAllProjectRuntimes(): Promise<void> {
  await disposeProjectRuntimes([...registrations.keys()])
}

export function resetProjectRuntimesForTests(): void {
  registrations.clear()
}
