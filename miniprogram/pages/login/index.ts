import { bindExistingAccount, loginWithWechat, registerAccount } from '../../services/auth';
import { messageOf } from '../../services/http';
import { showLegalDocument } from '../../domain/legal-copy';

Page({
  data: {
    statusBarHeight: 24,
    stage: 'wechat',
    formMode: 'bind',
    bindingTicket: '',
    username: '',
    password: '',
    displayName: '',
    accepted: false,
    submitting: false,
    error: '',
  },

  onLoad() {
    this.setData({ statusBarHeight: wx.getWindowInfo?.().statusBarHeight || 24 });
  },

  onToggleAccepted() {
    this.setData({ accepted: !this.data.accepted, error: '' });
  },

  onOpenLegal(event: any) {
    showLegalDocument(event.currentTarget.dataset.document === 'privacy' ? 'privacy' : 'terms');
  },

  onModeChange(event: any) {
    this.setData({ formMode: event.currentTarget.dataset.mode, error: '' });
  },

  onInput(event: any) {
    this.setData({ [event.currentTarget.dataset.field]: event.detail.value, error: '' });
  },

  async onWechatLogin() {
    if (!this.data.accepted) {
      this.setData({ error: '请先阅读并同意隐私政策和用户协议' });
      return;
    }
    this.setData({ submitting: true, error: '' });
    try {
      const result = await loginWithWechat();
      if (result.status === 'authenticated') {
        wx.reLaunch({ url: '/pages/home/index' });
        return;
      }
      if (result.status === 'binding_required') {
        this.setData({
          stage: 'binding',
          bindingTicket: result.bindingTicket,
          submitting: false,
        });
      }
    } catch (error) {
      this.setData({ error: messageOf(error), submitting: false });
    }
  },

  async onSubmitAccount() {
    if (!this.data.username.trim() || !this.data.password) {
      this.setData({ error: '请填写用户名和密码' });
      return;
    }
    this.setData({ submitting: true, error: '' });
    try {
      if (this.data.formMode === 'bind') {
        await bindExistingAccount(
          this.data.bindingTicket,
          this.data.username.trim(),
          this.data.password,
        );
      } else {
        await registerAccount(
          this.data.bindingTicket,
          this.data.username.trim(),
          this.data.password,
          this.data.displayName.trim(),
        );
      }
      wx.reLaunch({ url: '/pages/home/index' });
    } catch (error) {
      this.setData({ error: messageOf(error), submitting: false });
    }
  },

  onRestart() {
    this.setData({
      stage: 'wechat',
      bindingTicket: '',
      username: '',
      password: '',
      displayName: '',
      submitting: false,
      error: '',
    });
  },
});
