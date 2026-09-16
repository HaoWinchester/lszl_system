import { showDialog } from './dialog';
import { navigation } from './navigation';
export async function openMembershipOffer() {
  const decision = await showDialog({
    title: '需要会员权限',
    content: '当前账号暂无这份试卷的访问权限。可查看账号权益与帮助，或返回选择免费试卷。',
    confirmText: '账号帮助', cancelText: '返回试卷',
  });
  if (decision.confirm) navigation.navigateTo({ url: '/pages/membership/index' });
}
