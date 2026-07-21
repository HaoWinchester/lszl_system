'use strict'

window.KG_APP_CONFIG = {
  ...(window.KG_APP_CONFIG || {}),
  auth: {
    mode: 'remote',
    baseUrl: '',
    credentials: 'include',
    allowLocalRegistration: true,
    endpoints: {
      login: '/api/v1/auth/login',
      register: '/api/v1/auth/register',
      logout: '/api/v1/auth/logout',
      session: '/api/v1/auth/me',
    },
  },
}
