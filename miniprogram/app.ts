import { getSessionToken } from './services/session';

App({
  globalData: {
    authenticated: Boolean(getSessionToken()),
    networkOnline: true,
  },
  onLaunch() {
    this.globalData.authenticated = Boolean(getSessionToken());
    wx.getNetworkType({
      success: ({ networkType }: { networkType: string }) => {
        this.globalData.networkOnline = networkType !== 'none';
      },
    });
    wx.onNetworkStatusChange(({ isConnected }: { isConnected: boolean }) => {
      this.globalData.networkOnline = isConnected;
    });
  },
});
