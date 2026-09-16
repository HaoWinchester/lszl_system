# 正式发布：小程序后端、退款条款与遗漏功能恢复

用户于2026-09-16明确要求“部署吧”。已将已验证的uat快进合入main并推送；业务部署提交为580689f02ecffed33b5319b5873f0b559a25face。

## 发布结果

- 正式地址：https://lszl.aihuanpu.com
- 实际容器与公开页面版本：v9.0-p4.1.234。
- 正式脚本 `bash deploy/update.sh` exit 0，总152秒，其中备份128秒。
- 网站及数据库健康检查通过。
- 小程序29条必需路由、13张表、迁移head、凭证存在及demo=false检查全部通过。
- AppID确认为已注册小程序，复用既有UAT凭证，在远端受限文件中配置；未在日志/Git/小程序包中输出或写入密钥。
- 实际HTTP核对退款6项内容、评论资源、练习与成绩单挂载点及两类登录提示监听全部通过；两份协议article与候选源完全一致。
- 未登录访问个人session、growth、subscription返回401；公开试卷目录按既有设计返回200。首次smoke误把公共目录也预期401，核对optional_current_user路由后更正期望，未修改产品权限行为。

## 备份与回滚

所有备份均验证非空及归档/dump格式可读，未删除既有正式备份。

1. 配置前额外备份 `/home/ubuntu/lszl-backups/mini-release-preconfig-20260916_164532`：包含实际运行镜像 `/app` 中的backend/frontend代码、主机部署文件、正式kg_graph数据库dump及manifest；回滚镜像 `lszl-kg-backend:rollback-preconfig-20260916_164532`。
2. 正式脚本备份 `/home/ubuntu/lszl-backups/20260916_164843`：代码、正式数据库dump、manifest；回滚镜像 `lszl-kg-backend:rollback-20260916_164843`。

注意旧主机release目录指针曾停留.159，而实际正式容器为.225，因此额外保留运行容器代码，不能只凭主机目录版本判断线上。

## 小程序状态与边界

- 1.0.5开发版已在前序任务成功上传，并在开发者工具核对完整退款条款。
- 正式小程序代码已预设连接正式域名，域名由用户明确确认已配置。
- 本次完成正式PC/后端部署，没有执行微信后台设置体验版、提交审核或正式发布。
- 本次上线后验证为服务就绪和只读HTTP检查，不冒充实体手机微信登录/做题业务验收。前序UAT三账号及自动化测试记录另见相关报告。

## 证据

工作树artifacts/production-refund-release/下保存backup-before-config.log、deploy.log、live-verification.json、auth-boundary.json；均不含密钥或数据库内容。完整候选验收737后端、279前端、小程序246项通过，四组视觉差异0%，以及跨页登录退出浏览器检查见退款恢复报告。
