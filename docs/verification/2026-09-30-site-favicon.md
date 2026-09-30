# 页签图标修复（本地）

版本：v9.0-p4.1.265。

## 原因与修改

`assets/logo.jpg` 返回 200，但大多数页面未声明 favicon，默认 `/favicon.ico` 返回 404。落地页另有内嵌 SVG 图标。

同步脚本统一为所有页面入口注入唯一的 `rel="icon"`，指向带版本号的 `/assets/logo.jpg`；包含内容准备工作室、题目工作室和自动生成的 workbench。复用原图，不修改搜索引擎验证文件。

## 验证

- 新增回归测试修复前失败、修复后通过：检查各入口的唯一图标声明、版本路径和图片原样复制，以及验证文件不变。
- `pnpm --dir frontend test`：302 个 Node 测试、9 个运行契约测试、4 个部署脚本自测通过（未执行部署）。
- 本地生成产物：31 个页面入口均声明唯一的图标。
- 本地 HTTP：图标返回 200、image/jpeg，字节与源文件相同。
- Chromium 实测 landing、practice-mode、knowledge-recall、question-workspace：均正确解析图标地址并解码为 1254 × 1254 图片。
- `git diff --check` 通过。

浏览器使用 headless Chromium，未人工确认原生页签栏像素；管理页面和嵌套入口验证了生成 HTML，未额外执行登录流程。仅更新本地 5179 预览，未部署 UAT 或正式环境。
