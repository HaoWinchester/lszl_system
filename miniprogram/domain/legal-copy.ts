export type LegalDocumentKind = 'privacy' | 'terms';

const DOCUMENTS = {
  privacy: {
    title: '隐私政策',
    content: '登录会使用微信身份标识，并同步你在幻谱系统中的学习进度。账号、做题记录、错题与成绩数据由服务器保存，仅用于学习服务。',
  },
  terms: {
    title: '用户协议',
    content: '请使用本人账号学习，并遵守题库使用规则。提交后生成的成绩、错题和学习进度会同步到你的系统账号。',
  },
};

export function legalDocument(kind: LegalDocumentKind) {
  return DOCUMENTS[kind];
}

export function showLegalDocument(kind: LegalDocumentKind) {
  const document = legalDocument(kind);
  return wx.showModal({ ...document, showCancel: false, confirmText: '知道了' });
}
