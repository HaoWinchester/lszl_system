# 新题型样卷 UAT 发布准备

用户要求：根据《新题型测试.docx》制作一套试卷，并在 UAT 查看。

## 样卷

内容保存在 `docs/samples/mixed-question-uat-20260910/`。名称为“新题型体验卷（图表·案例·连线）”，五道计分题：一题图表单选、三个共享案例单选、一道四对匹配题。内容整理说明见同目录 README。图表原图已经提取，样卷发布脚本通过应用服务上传图片、保存材料、创建题目和试卷、发布冻结快照；仅允许连接 `kg_graph_uat`。

## 已完成

- 五道题经过现有后端规范化、题型校验、答案判分和完整案例分组校验，全部通过。
- 新题型功能与样卷已合入并推送 `uat`。`main` 没有修改。
- 候选 release `v9.0-p4.1.225` 的 full 验证通过：开始于 2026-09-10 12:03:40 UTC，完成于 12:15:03 UTC。执行了发布脚本规定的后端测试、前端契约、浏览器流程和视觉比较。前端 Node 契约 250 项通过。
- 本地候选和原本地 active site 均为 990 文件；与实际 UAT 的 985 个文件逐一比较，无删除文件，只增加新题型的两个 JS、一个 CSS 和两个测试文件。关键页面存在。
- 完成同步产物和 runtime 打包准备。
- UAT 代码和数据库备份已验证非空且归档可读：`/home/ubuntu/backups/lszl-kg-uat/20260910T120224Z-mixed-question-demo`，包括 `code.tar.gz`、`uat.dump`、`manifest.txt`。

## 当前阻塞

服务器可用空间起初约 1.9GB。清理未使用的 Docker 构建缓存后约 2.4GB，仍小于 `deploy/update-uat.sh` 的最低 5GB 要求。没有降低或绕过部署门槛。其他项目目录和正式备份未清理，已向用户询问可清理范围或释放空间。

截至本次准备记录，UAT 仍为 `v9.0-p4.1.224`，远端部署提交为 `51f11350d4fdcb51e64f54969788d998fd4c450a`。新功能尚未部署，样卷尚未写入 UAT。实际 UAT 新样卷的拖拽、续作和判分验证也尚未执行。

## 空间恢复后的步骤

1. 在干净的功能工作区检查 `uat` 和远端基线，执行 `bash deploy/update-uat.sh`；现有 full 验证结果在源、适配层和验证器指纹一致时可复用。
2. 将 `docs/samples/mixed-question-uat-20260910/` 中的 JSON、PNG 和 `publish.py` 复制到 UAT 容器的 `/tmp/mixed-question-demo/`，执行 `PYTHONPATH=/app python /tmp/mixed-question-demo/publish.py --actor admin`，保存返回的题库、试卷、发布版本 ID。
3. 以独立的临时学生账号验证：题库大厅可见 5 题、图片加载与放大、案例桌面/手机布局、四对拖拽/键盘配对、部分配对保存续作、最终 5/5 判分。自动检查脚本准备在当前工作区 `.superpowers/uat-mixed-demo/verify_browser.py`；需新建临时账号及保存发布 ID。
4. 向用户提供 `https://uat.aihuanpu.com/practice-mode.html` 和试卷名称，等待用户本人业务验收；不要合入 `main`。
