# 文件管理「返回画布」按钮 — UAT 309

## 改动

- 根据用户参考图，将侧栏底部的小文字链接替换为整行图标按钮「返回画布」。
- 52px 最小高度、20px 返回图标、浅紫背景与紫色边框、14px 圆角；复用现有主题变量支持深色。
- 保留原 `index.html` 跳转；隐藏底部账号空间标签，避免长名字挤压按钮。账号菜单与移动端快捷返回保持原有行为。
- 增加清晰的键盘聚焦状态；侧栏折叠行为保持兼容。
- 权威源：`new-legacy/file-manager.html`、`new-legacy/styles/file-manager.css`。同步产物和版本号由正式发布工具生成。

## 开发自检

- `node --test frontend/scripts/design-contract.test.mjs frontend/scripts/file-manager-search-input.test.mjs`：6/6 通过。
- `bash deploy/update-uat.sh`：full 验证及部署成功。内置后端 971 项、前端 317 项、扩展 10 项及全部配置/部署契约、浏览器和视觉检查通过；视觉基线四场景差异均为 0%。完整验证约 1073 秒，部署总计 1135 秒。
- 新旧发布 site 均为 1051 文件，关键 admin-console 页面存在。生成文件除按钮改动与 308→309 版本替换外无其他 HTML/CSS 变化。
- 专项 Chrome 实测本地及 UAT：1440×900、1024×600、820×700，浅色/深色各 3 档；按钮填满容器、最小高度 52px、图标 20px、无文字溢出；键盘聚焦、侧栏收起/展开、点击返回画布通过。
- UAT 使用 admin 登录后的实际文件管理页复验，并检查截图。专项脚本及截图保存在忽略目录 `artifacts/file-manager-return-canvas/`。
- 本次未增加业务逻辑和数据库写入；未另外执行独立全量后端命令，已由 full 发布验证运行。

## 发布结果

- UAT：https://uat.aihuanpu.com/file-manager.html，公网版本 `v9.0-p4.1.309`。
- UAT 健康与数据库检查均 ok。
- 正式环境仍为 `v9.0-p4.1.293`，健康与数据库检查均 ok。
- 实现提交 `c2df42436ad10d34d74b9625d5cb77736baf206d` 已进入 uat；等待用户验收，未合入 main。
- main 保持 `7a24be322c4c560cc340ba1fdc4423d19a63df89`。
