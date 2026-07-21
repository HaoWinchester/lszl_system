import { guidedLearningFrameAdapter } from '../iframe/guidedLearningFrameAdapter'
import NewLegacyFrame from './NewLegacyFrame'

export default function GuidedLearningNode() {
  return <NewLegacyFrame adapter={guidedLearningFrameAdapter} page="guided-learning-node.html" src="/new-legacy/guided-learning-node.html" title="节点学习" />
}
