# 正式环境手机标记按钮修复（v9.0-p4.1.219）

用户明确要求将已验收的按钮修复更新到正式环境。本次从 main 提取已验收的前端源与回归测试，不合入 UAT 的其他功能。

## 范围

- 业务改动仅为 `new-legacy/styles/practice-mode.css`：标记按钮参与题卡正常排版，靠右单独占位，题干前保留 12px 间距，800px 以下最小点击高度为 40px。
- 同步版本号、缓存引用、manifest、同步报告与课程 seed 的版本元数据；后台 Python 业务代码、数据库迁移和生产 compose 均未修改。
- 主程序提交 `e3d03f9` 已推送 main 并核对远程引用。当前工作区的其他未提交修改保留。
- 使用 `node frontend/scripts/manage-new-legacy.js update new-legacy --skip-browser` 构建和 promote 不可变版本，未手工覆盖 active release site。

## 验证

- `python3 new-legacy/tests/practice-mark-show-answers-browser.py` 通过：普通练习与挑战、8 种屏宽、长短题干、标记/取消、答题卡、保存恢复。
- `cd frontend && pnpm test`：240 个 Node 契约、9 个 Python 契约、4 项部署脚本隔离测试通过。
- `cd frontend && pnpm test:design`：5/5 通过；`git diff --check` 通过。
- 正式候选包与本轮 UAT 完整发布验收通过的 v219 包，985 个文件 SHA-256 逐项一致；与正式旧 v217 包文件集合一致，关键管理页存在。
- 引用 UAT `validation.json` 的完整验收记录：`passed=true`、`profile=full`、完成于 `2026-09-08T07:23:20.319Z`。sourceHash 为 `4bb45ad408f4b6325f137d545efd6327b94978e4a55eb37ce6fa0f216a4220ad`，adapterHash 为 `61240ee38528e114a3f089cb07612d8dd2362cfd840773b95185ec9d0b6a9d1d`。本次没有重复运行未改变的后台完整测试。
- 发布前将当前正式容器内 Python 文件与本地发布工作树逐项对比，无差异。
- 发布后正式容器 active release 的全部 985 个文件与验收包完全一致；公网 CSS 与权威源逐字节一致；HTTPS 健康接口返回 `status=ok`、`db=ok`。
- agent-browser 在正式 390px 视口确认版本 v219，按钮 position=static、min-height=40px、margin-bottom=12px。未进行实体手机测试。

## 备份与部署

- 使用既有 `bash deploy/update.sh`，在任何正式同步、镜像构建、重启之前完成备份与格式校验。
- 备份目录：`/home/ubuntu/lszl-backups/20260908_163412`。
- 代码包：`repo_20260908_163412.tar.gz`；数据库：`db_20260908_163412.dump`；清单：`manifest.txt`。
- 代码包与数据库 dump 均确认非空，分别通过 `tar -tzf`、`pg_restore --list`；未执行数据库还原演练。
- 回滚镜像：`lszl-kg-backend:rollback-20260908_163412`；上一正式版本 v217 随发布保留。
- 正式地址：https://lszl.aihuanpu.com/practice-mode.html 。
