import { create } from 'zustand'

import { authApi, type AppUser } from '../api/auth'

interface AuthState {
  user: AppUser | null
  initialized: boolean
  init: () => Promise<void>
  login: (username: string, password: string) => Promise<void>
  register: (data: { username: string; password: string; display_name?: string; subject?: string }) => Promise<void>
  wechatLogin: (code: string, state: string) => Promise<void>
  wechatDemoLogin: () => Promise<void>
  logout: () => Promise<void>
  setUser: (u: AppUser | null) => void
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  initialized: false,
  init: async () => {
    try {
      const u = await authApi.me()
      set({ user: u, initialized: true })
    } catch {
      set({ user: null, initialized: true })
    }
  },
  login: async (username, password) => {
    const u = await authApi.login(username, password)
    set({ user: u })
  },
  register: async (data) => {
    const u = await authApi.register(data)
    set({ user: u })
  },
  wechatLogin: async (code, state) => {
    const u = await authApi.wechatLogin(code, state)
    set({ user: u })
  },
  wechatDemoLogin: async () => {
    const u = await authApi.wechatDemoLogin()
    set({ user: u })
  },
  logout: async () => {
    try {
      await authApi.logout()
    } finally {
      set({ user: null })
    }
  },
  setUser: (u) => set({ user: u }),
}))
