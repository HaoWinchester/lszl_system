'use strict';

/*
 * Question Studio 在线直连配置。
 * 离线/原型阶段保持空字符串，将提交到同源浏览器活动库。
 * 部署正式后端后填写 HTTPS 接口，例如：/api/activities/import。
 * 教师账号必须由服务器登录会话确定，服务器不得信任前端提交的作者 ID。
 */
(function(global){
  const existing=global.KG_SERVER_CONFIG||{};
  global.KG_SERVER_CONFIG=Object.freeze({
    ...existing,
    activityImportEndpoint:String(existing.activityImportEndpoint||''),
    credentials:'include'
  });
})(window);
