import { bindExistingAccount, loginWithWechat, registerAccount } from '../../services/auth';
import { messageOf } from '../../services/http';

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
    const privacy = event.currentTarget.dataset.document === 'privacy';
    wx.showModal({
      title: privacy ? '隐私政策' : '用户协议',
      content: privacy
        ? '登录会使用微信身份标识，并同步你在幻谱系统中的学习进度。账号和做题数据由服务器保存。'
        : '请使用本人账号学习，遵守题库使用规则。提交后生成的成绩、错题与经验会同步到你的账号。',
      showCancel: false,
      confirmText: '知道了',
    });
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
