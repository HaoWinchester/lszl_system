import { guidedLearningFrameAdapter } from '../iframe/guidedLearningFrameAdapter'
import NewLegacyFrame from './NewLegacyFrame'

export default function GuidedLearningPlacementTest() {
  return <NewLegacyFrame adapter={guidedLearningFrameAdapter} page="guided-learning-placement-test.html" src="/new-legacy/guided-learning-placement-test.html" title="部分跳级测试" />
}
