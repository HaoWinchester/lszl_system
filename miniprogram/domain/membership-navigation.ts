import { showDialog } from './dialog';
import { navigation } from './navigation';
export async function openMembershipOffer() {
  const decision = await showDialog({
    title: '需要会员权限',
    content: '当前账号暂无这份试卷的访问权限。可以查看账号权益，或返回选择可用试卷。',
    confirmText: '查看信息', cancelText: '返回试卷',
  });
  if (decision.confirm) navigation.navigateTo({ url: '/pages/membership/index' });
}
