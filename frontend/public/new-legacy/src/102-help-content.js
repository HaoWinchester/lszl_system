'use strict';
(function(global){
  const docs=[
    {
      id:'home',title:'图谱首页',href:'index.html',keywords:['首页','图谱','卡牌','连线','画布'],summary:'创建、整理和浏览个人知识图谱。',
      sections:[
        {title:'主要用途',body:'在无限画布中创建知识卡牌、整理知识关系，并通过文件页签管理不同图谱。'},
        {title:'常用操作',body:'使用左侧工具栏新增卡牌和连线；滚轮或双指缩放画布；拖动画布查看不同区域；账号右侧的问号入口可打开帮助、反馈和消息。'},
        {title:'保存说明',body:'登录后，图谱与学习数据会按账号保存到服务器，并可在刷新或重新登录后恢复。'}
      ]
    },
    {
      id:'multi-question',title:'多题画布',href:'question-workspace.html',keywords:['多题画布','试卷','题目卡','归纳'],summary:'从已发布试卷中把多道题放入同一画布进行整理。',
      sections:[
        {title:'选择题目',body:'题目来源只包含试卷管理中已经发布、且允许用于多题画布的固定版本。'},
        {title:'进入单题深学',body:'在题目卡中点击“进入单题深学”，会保留试卷、发布版本和题目上下文。'},
        {title:'工作区保存',body:'画布会记录题目来源和布局；教师后续修改原题不会改变当前发布版本中的冻结内容。'}
      ]
    },
    {
      id:'deep-recall',title:'深度回忆',href:'knowledge-recall.html',keywords:['深度回忆','回忆','联想','知识图谱'],summary:'围绕已发布试卷题目建立回忆线索和知识关系。',
      sections:[
        {title:'题目来源',body:'只读取试卷管理中已发布、且启用了深度回忆的固定发布版本。'},
        {title:'返回首页',body:'页面左上角返回按钮会回到图谱首页。'},
        {title:'联想内容',body:'科目级联想库由管理后台维护；学员端只读取正式启用版本。'}
      ]
    },
    {
      id:'single-deep',title:'单题深学',href:'question-training.html',keywords:['单题深学','单题','训练配置','题目'],summary:'对一张已发布试卷中的单道题进行深入整理。',
      sections:[
        {title:'进入方式',body:'通常从多题画布中的题目卡进入，页面会自动定位对应试卷版本和题目。'},
        {title:'题目一致性',body:'页面读取发布时冻结的题目快照，不读取教师草稿或演示题库。'},
        {title:'退出方式',body:'完成后可返回多题画布，继续处理同一工作区中的其他题目。'}
      ]
    },
    {
      id:'practice',title:'做题模式',href:'practice-mode.html',keywords:['做题','挑战','学霸','倒计时','经验值'],summary:'使用挑战或学霸模式练习已发布试卷。',
      sections:[
        {title:'练习数量',body:'可按试卷题量选择 10、20、60 或 180 道题，并选择按顺序或随机练习。'},
        {title:'挑战模式',body:'答错会扣除血量；连续答对可以获得额外经验，并在检查点查看连胜、经验值和耗时。'},
        {title:'学霸模式',body:'使用 80 秒共享时间池。答对恢复 20 秒，答错扣除 20 秒并掉血；危险时间会出现渐进红色视野。'},
        {title:'退出与结算',body:'两种模式均不可暂停。结算只显示正确率、总耗时和经验值。'}
      ]
    }
  ];
  global.KGHelpContent=Object.freeze({docs:Object.freeze(docs.map(doc=>Object.freeze(doc))) });
  if(typeof module!=='undefined'&&module.exports)module.exports=global.KGHelpContent;
})(typeof window!=='undefined'?window:globalThis);
