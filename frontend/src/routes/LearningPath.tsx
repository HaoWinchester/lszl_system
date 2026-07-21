import { guidedLearningFrameAdapter } from '../iframe/guidedLearningFrameAdapter'
import NewLegacyFrame from './NewLegacyFrame'

export default function LearningPath() {
  return <NewLegacyFrame adapter={guidedLearningFrameAdapter} page="learning-path.html" src="/new-legacy/learning-path.html" title="学习路径" />
}
