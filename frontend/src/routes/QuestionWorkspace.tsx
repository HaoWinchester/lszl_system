import { workspaceFrameAdapter } from '../iframe/workspaceFrameAdapter'
import NewLegacyFrame from './NewLegacyFrame'

export default function QuestionWorkspace() {
  return <NewLegacyFrame adapter={workspaceFrameAdapter} page="question-workspace.html" src="/new-legacy/question-workspace.html" title="多题归纳画布" />
}
