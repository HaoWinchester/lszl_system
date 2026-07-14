import { Navigate, Route, Routes } from 'react-router-dom'

import RequireAuth from './components/RequireAuth'
import Files from './routes/Files'
import GraphEditor from './routes/GraphEditor'
import Login from './routes/Login'
import Member from './routes/Member'
import QuestionBank from './routes/QuestionBank'
import Recall from './routes/Recall'
import Settings from './routes/Settings'
import Training from './routes/Training'
import Users from './routes/Users'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <GraphEditor />
          </RequireAuth>
        }
      />
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
      <Route
        path="/training"
        element={
          <RequireAuth>
            <Training />
          </RequireAuth>
        }
      />
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
