'use strict';

/*
 * RuntimeConfig v1
 * 部署时只需修改本文件即可切换认证提供方。
 * local-demo 仅适用于原型/离线演示；正式环境请改为 remote 并配置 HTTPS 后端。
 */
(function(global){
  const existing=global.KG_APP_CONFIG||{};
  global.KG_APP_CONFIG=Object.freeze({
    ...existing,
    auth:Object.freeze({
      mode:'local-demo',
      baseUrl:'',
      credentials:'include',
      allowLocalRegistration:true,
      endpoints:Object.freeze({
        login:'/api/auth/login',
        register:'/api/auth/register',
        logout:'/api/auth/logout',
        session:'/api/auth/session'
      }),
      ...(existing.auth||{})
    }),
    engagement:Object.freeze({
      mode:'local-demo',
      baseUrl:'',
      credentials:'include',
      endpoints:Object.freeze({
        submitFeedback:'/api/feedback',
        myFeedback:'/api/feedback/mine',
        adminFeedback:'/api/admin/feedback',
        messages:'/api/messages',
        adminMessages:'/api/admin/messages',
        markMessageRead:'/api/messages/{id}/read',
        markAllRead:'/api/messages/read-all',
        markFeedbackRead:'/api/feedback/{id}/read'
      }),
      ...(existing.engagement||{})
    })
  });
})(window);
