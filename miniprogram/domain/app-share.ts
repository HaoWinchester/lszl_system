// Share the app, never a learner's account, answers, session URL or screen capture.
// Keep this separate from appearance so every page opts into the same safe payload.
export function withAppShare(options: any) {
  return {
    ...options,
    onShareAppMessage() {
      return {
        title: '幻谱知习 · 每天一小步，让知识更扎实',
        path: '/pages/tabs/index',
        imageUrl: '/assets/share-logo.jpg',
      };
    },
  };
}
