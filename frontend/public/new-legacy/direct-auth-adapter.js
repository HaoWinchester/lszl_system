'use strict'

;(function (global) {
  const core = global.KGAuthCore
  if (!core) return

  function message(text = '', ok = false) {
    const element = document.getElementById('authMsg')
    if (!element) return
    element.textContent = String(text || '')
    element.classList.toggle('ok', Boolean(ok))
  }

  function setBusy(busy) {
    for (const id of ['authDoLoginBtn', 'authRegisterBtn', 'authLogoutBtn']) {
      const button = document.getElementById(id)
      if (button) button.disabled = Boolean(busy)
    }
  }

  function acceptedTermsVersion() {
    // 优先走共享登录弹窗本体：KGAuthRuntime 曾被其他脚本整体覆盖丢掉条款字段，
    // 回退到 KGSharedAuthDialog 保证登录链路不因字段缺失而静默失败。
    const dialog = global.KGSharedAuthDialog
    const runtime = global.KGAuthRuntime
    const requireConsent = dialog?.requireLegalConsent || runtime?.requireLegalConsent
    if (typeof requireConsent === 'function' && !requireConsent()) return ''
    return String(runtime?.legalConsentVersion || dialog?.legalConsentVersion || '')
  }

  async function remoteLogin(username, password) {
    username = core.cleanUsername(username)
    password = String(password || '')
    if (!username || !password) {
      message('请输入用户名和密码。')
      return false
    }
    const consentVersion = acceptedTermsVersion()
    if (!consentVersion) return false
    setBusy(true)
    message('正在验证账号…')
    try {
      const result = await core.login(username, password, {
        source: 'new-legacy-direct',
        acceptedTermsVersion: consentVersion,
      })
      if (!result?.ok) {
        message(result?.message || '登录失败，请重试。')
        return false
      }
      message('登录成功，正在载入账号数据…', true)
      return true
    } catch (error) {
      message(String(error?.message || error || '登录失败，请重试。'))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function remoteRegister(username, password) {
    username = core.cleanUsername(username)
    password = String(password || '')
    if (username.length < 2) {
      message('用户名至少需要 2 个字符。')
      return false
    }
    if (password.length < 4) {
      message('密码至少需要 4 个字符。')
      return false
    }
    const consentVersion = acceptedTermsVersion()
    if (!consentVersion) return false
    setBusy(true)
    message('正在创建账号…')
    try {
      const result = await core.register(username, password, {
        source: 'new-legacy-direct',
        acceptedTermsVersion: consentVersion,
      })
      if (!result?.ok) {
        message(result?.message || '注册失败，请重试。')
        return false
      }
      message('注册成功，正在载入账号数据…', true)
      return true
    } catch (error) {
      message(String(error?.message || error || '注册失败，请重试。'))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function remoteLogout() {
    setBusy(true)
    try {
      await core.logout({ source: 'new-legacy-direct' })
      return true
    } finally {
      setBusy(false)
    }
  }

  global.authLogin = remoteLogin
  global.authRegister = remoteRegister
  global.authLogout = remoteLogout
})(window)
