'use strict';
(function(global){
  const ENTRIES=Object.freeze({
    'training-recall':Object.freeze({
      title:'快速回忆配置',
      summary:'本页只配置当前题目的可点击关键词，以及关键词要进入哪个联想库节点。',
      items:Object.freeze([
        '关键词必须出现在题干或选项中；保存时系统会自动定位。',
        '“关键词 → 知识联想入口”每行填写一组，入口可以是联想库节点名称或稳定节点 ID。',
        '本题配置保存后，还需在“科目与知识树 → 科目级联想库”维护节点内容、联想目标并发布启用。',
        '点击“预览完整版深度回忆”会先保存当前配置，再使用教师草稿预览。'
      ]),
      note:'题目配置负责“从哪里进入”，科目级联想库负责“进入后看到什么”。'
    }),
    'association-library':Object.freeze({
      title:'科目级联想库',
      summary:'按科目集中维护可复用的关键词节点和后续联想关系。',
      items:Object.freeze([
        '新建或编辑节点后，先点击“保存到草稿”或顶部“保存草稿”。',
        '“联想目标”每行一个目标关键词；保存时会建立从当前节点出发的关系。',
        '草稿不会被学习端读取，完成检查后必须点击“发布启用”。',
        '题目中的知识联想入口建议绑定稳定节点 ID，节点改名后关系仍然有效。'
      ]),
      note:'学习端只读取最近一次正式发布版本，导入和草稿修改不会立即影响学员。'
    }),
    'paper-management':Object.freeze({
      title:'试卷管理',
      summary:'试卷草稿、正式发布和归档是三个不同状态，历史发布版本始终保留。',
      items:Object.freeze([
        '发布前可分别选择刷题、深度回忆和归纳；只有勾选的入口能够调用该版本。',
        '“发布试卷 / 发布新版本”会生成不可变快照，并出现在已勾选的学员端入口。',
        '“取消发布”只从学员端下架当前正式版本，试卷恢复为可编辑草稿，历史版本不删除。',
        '“归档试卷”用于暂停维护并下架；归档后需先“取消归档”才能再次发布。',
        '“取消归档”恢复为可编辑草稿，不会自动重新发布；确认后可发布新版本。'
      ]),
      note:'取消发布或取消归档后再次发布，版本号会在历史最高版本基础上继续递增。'
    })
  });
  global.KGModuleHelpContent=Object.freeze({
    get(id){const entry=ENTRIES[String(id||'')];return entry?JSON.parse(JSON.stringify(entry)):null},
    ids:()=>Object.keys(ENTRIES)
  });
})(globalThis);
