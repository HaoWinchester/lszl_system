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
      profile: '/api/v1/auth/me',
    },
  },
  engagement: {
    mode: 'remote',
    baseUrl: '',
    credentials: 'include',
    endpoints: {
      submitFeedback: '/api/v1/engagement/feedback',
      myFeedback: '/api/v1/engagement/feedback/mine',
      adminFeedback: '/api/v1/engagement/admin/feedback',
      messages: '/api/v1/engagement/messages',
      adminMessages: '/api/v1/engagement/admin/messages',
      markMessageRead: '/api/v1/engagement/messages/{id}/read',
      markAllRead: '/api/v1/engagement/messages/read-all',
      markFeedbackRead: '/api/v1/engagement/feedback/{id}/read',
      unreadSummary: '/api/v1/engagement/unread-summary',
    },
  },
}
