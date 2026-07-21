import { trainingFrameAdapter } from '../iframe/trainingFrameAdapter'
import NewLegacyFrame from './NewLegacyFrame'

export default function Training() {
  return (
    <NewLegacyFrame
      adapter={trainingFrameAdapter}
      page="question-training.html"
      src="/new-legacy/question-training.html"
      title="考题训练"
    />
  )
}
