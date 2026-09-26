# 导入重试收尾与习题课免费开放

## 对话框修复

前一轮浏览器实测复现：确认导入成功会关闭对话框，重试按钮仅调用 controller.retry()，缺少成功收尾。将确认、重试统一接入 submitPaperImport；只在 result.ok 且存在实际导入 result 时提示成功并关闭。预检成功仅返回 preflight，保留对话框供用户确认，避免把预检重试误当成导入成功。

修复位于 `new-legacy/src/65-question-bank-admin.js`；7 项现有防重测试通过。按标准发布链更新 UAT，不合入 main、不更新正式代码。

## 正式内容权限已更新

2026-09-26 按用户明确要求，经现有 API 为两套习题课发布第 2 版。发布前已保存原试卷、发布历史及完整题目快照到根工作区 `artifacts/free-exercises-2026-09-26/`。

| 内容 | 题数 | 正式新发布版本 |
|---|---:|---|
| PMP 习题课｜财务绩效域｜12题 | 12 | pr_707cd52ad9f04829b308557834c8716e |
| PMP 习题课｜进度绩效域｜13题 | 13 | pr_d15496a1ac1147fe9922ef16cbcfccd2 |

- accessLevel=free；allowedRoles=[admin,teacher,student]。
- enabledModes=[deep_recall,multi_question_canvas]；做题模式保持关闭。
- 仍是独立“习题课”副本，没有重新导入题库或覆盖原题库。
- 逐题比较新旧发布的 ID、题型、题干、选项、答案、解析所需概念、原则元数据、联想词和推理步骤，内容一致。
- 草稿/发布说明改为教师和学员免费使用；发布元数据同步撤销仅教师待检查标记。

## 免费学员验证

创建临时教师、学员账号验证后清理。新学员套餐为 free，allExamPapers=false。目录能找到两套习题课，题目接口分别 200 返回全部 12/13 题。浏览器实际从题目库选择题目：财务第 9 题多选正常显示，进度第 1 题正常显示；在归纳画布分别从两套题库加入 1 题，画布最终显示“2 卡 · 2 题”。

证据位于根工作区 `artifacts/free-exercises-2026-09-26/`：result.json、role-verification.json、student-subscription.json、student-finance-recall.png、student-schedule-recall.png、student-both-canvas.png。

清理临时账号时发现现有删除用户接口未处理 subscriptions 外键，先通过受严格账号和来源检查约束的事务清理此次临时账号的 2 条默认免费订阅、2 条回忆进度、1 个画布，再通过正常删除用户 API 删除两名临时用户。真实用户、内容与学习记录未参与清理；该既有删除缺陷未混入本次代码修改。cleanup.json 记录两个临时账号均 deleted=1。

## UAT v241 发布与修复后实测

- 标准 `deploy/update-uat.sh` 发布 UAT v9.0-p4.1.241 成功，公网版本与健康检查通过；完整校验 698 秒，总流程 732 秒。
- 后端 782 项、前端 280 项、跨业务浏览器测试通过，四个视觉回归样本差异均为 0%。v240/v241 均为 1010 文件，关键页面存在，无文件回退。
- 实际浏览器上传试卷并中断预检网络；恢复网络后点击“重试预检”，预检成功且对话框保持打开，可确认导入。
- 实际导入保存成功后，在浏览器丢弃响应模拟网络中断；点击“重试导入”后，对话框自动关闭，显示“试卷已导入，题目仍引用系统题库。”。
- 首次提交和重试共 2 请求，完整 payload/幂等键相同，返回同一试卷，重试 replayed=true。测试题库和试卷均经正常 API 删除（200）。
- 证据：本 UAT 工作树 `artifacts/retry-close-free-exercises/browser-result.json`、`retry-closes-success.png`、`deploy.log`。
- 再次逐项比较正式两套新旧发布的完整 question 对象（不限于抽取字段），25 题所有字段差异均为空。
- 本轮正式仅通过内容 API 更新上述两套发布权限；前端代码修复仍停留 UAT，未合入 main、未部署正式代码。
