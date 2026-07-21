import { Navigate, Route, Routes } from 'react-router-dom'

import RequireAuth from './components/RequireAuth'
import Files from './routes/Files'
import GuidedLearningNode from './routes/GuidedLearningNode'
import GuidedLearningPlacementTest from './routes/GuidedLearningPlacementTest'
import GraphEditor from './routes/GraphEditor'
import LearningPath from './routes/LearningPath'
import Login from './routes/Login'
import WechatCallback from './routes/WechatCallback'
import Member from './routes/Member'
import QuestionBank from './routes/QuestionBank'
import QuestionWorkspace from './routes/QuestionWorkspace'
import Recall from './routes/Recall'
import Settings from './routes/Settings'
import Training from './routes/Training'
import Users from './routes/Users'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/login/wechat/callback" element={<WechatCallback />} />
      <Route path="/" element={<LearningPath />} />
      <Route path="/graph" element={<GraphEditor />} />
      <Route path="/workspace" element={<QuestionWorkspace />} />
      <Route path="/learning/node" element={<GuidedLearningNode />} />
      <Route path="/learning/placement-test" element={<GuidedLearningPlacementTest />} />
      <Route
        path="/files"
        element={
          <RequireAuth>
            <Files />
          </RequireAuth>
        }
      />
      <Route
        path="/question-bank"
        element={
          <RequireAuth>
            <QuestionBank />
          </RequireAuth>
        }
      />
      <Route path="/training" element={<Training />} />
      <Route
        path="/recall"
        element={
          <RequireAuth>
            <Recall />
          </RequireAuth>
        }
      />
      <Route
        path="/users"
        element={
          <RequireAuth roles={['admin']}>
            <Users />
          </RequireAuth>
        }
      />
      <Route
        path="/settings"
        element={
          <RequireAuth roles={['admin']}>
            <Settings />
          </RequireAuth>
        }
      />
      <Route
        path="/member"
        element={
          <RequireAuth>
            <Member />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
