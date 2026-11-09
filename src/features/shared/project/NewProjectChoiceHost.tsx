import { useSyncExternalStore } from 'react'
import { createProjectRepository } from '../../../state/project/repository'
import { projectRoute, type WorkbenchId } from '../../../domain/shared/workbench'
import { useNavigate } from 'react-router-dom'
import { usePlatform } from '../../../app/providers/PlatformProvider'
import {
  closeNewProjectChoice,
  getNewProjectChoiceOpen,
  subscribeNewProjectChoice,
} from '../../../state/ui/newProjectChoice'
import { NewProjectChoice } from './NewProjectChoice'

/** 全应用唯一的新建项目选择宿主：侧栏、首页和项目页只发打开事件。 */
export function NewProjectChoiceHost() {
  const open = useSyncExternalStore(
    subscribeNewProjectChoice,
    getNewProjectChoiceOpen,
    getNewProjectChoiceOpen,
  )
  const platform = usePlatform()
  const navigate = useNavigate()

  if (!open) return null

  const create = async (workbench: WorkbenchId) => {
    const created = await createProjectRepository(platform.storage).create({ workbench })
    closeNewProjectChoice()
    navigate(projectRoute(workbench, created.id))
  }

  return (
    <NewProjectChoice onClose={closeNewProjectChoice} onChoose={(id) => void create(id)} />
  )
}
