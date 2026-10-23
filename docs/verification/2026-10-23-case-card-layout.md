# 深度回忆、多题归纳：案例左栏与16:9题框

两页共用`118-question-materials.js`的案例标记与初始尺寸规则、`question-materials.css`的左案例/右题目布局。桌面材料栏约占48%，题框随可用宽高放大，上限1360px，比例16:9；长材料和题目分别滚动。纯图片题保留原有右图布局，无案例普通题回退原样。窄卡改为案例在上、题目在下，深度回忆题框高度受视口约束。

多题归纳首次把旧默认宽度的案例卡扩宽，布局标记`caseLayoutVersion`由现有画布存储保存，后续自定义宽度保留；完整模式高度按宽度计算，窄卡采用可阅读高度。批量加入案例题时按实际大卡尺寸留位。未改后端API、数据库结构、知识星空、版本号或active release。

## 验证

- `python3 new-legacy/tests/case-card-layout-browser.py`：两页×1920/1440/1280/390共8组通过。检查左/右栏与宽度、桌面16:9、窄屏堆叠、真实鼠标滚轮和手机触摸滚动、长题滚动、折叠/展开、无材料与纯图片回退。先在旧布局复现右栏错误，再修改通过；移动端测试纠正了把多题归纳文档流错误地按深度回忆坐标居中的测试夹具。
- `python3 new-legacy/tests/question-material-card-browser.py`：图表真实解码、放大/Escape、失败重试、安全地址与图片布局兼容通过；案例窄卡预期更新为材料在前。
- 隔离数据库的真实发布/学生进入：三道案例小题×深度回忆/多题归纳共6条业务流程通过，包括真实材料/题目、解析、刷新与16:9布局；多题归纳手动宽度900px在重新打开后保留。使用现有`canvas_ink_server.py --role-matrix`创建独立数据库，退出码0，确认没有剩余测试数据库。未向本地真实账号写入案例、题目或学习记录。
- 定向Node：`graph-question-drawer.test.js`、`mixed-question-editor.test.js`、`v862-p2217-workspace-identity.test.js`共10项通过；补齐旧VM夹具缺失的浏览器`URL`构造器。三份修改的JS语法检查通过。
- `pnpm --dir frontend test`：377契约、9运行期检查、4组部署脚本测试通过。`pnpm --dir frontend test:design`：5项通过。未重复与本次纯前端布局无关的后端完整套件，也没有把部署脚本测试当作实际部署。

## 本地效果入口

- 深度回忆：http://127.0.0.1:5530/recall-case-layout.html?mode=recall
- 多题归纳：http://127.0.0.1:5530/recall-case-layout.html?mode=workspace

入口明确标记“布局样例”，使用同步后的实际共享模块和样式；样例只用于看版式，选项不作为真实作答入口。真实作答/发布流程在上述隔离环境验证。已查看桌面和手机截图，IAB已打开并实际切换两种布局。截图：`artifacts/recall-case-layout-20261023/preview-recall-1440.png`、`preview-workspace-1440.png`。

用户确认本地效果后，本轮已随知识星空部署到UAT385，尚未合入main。实际部署证据见[UAT部署记录](2026-10-23-knowledge-space-case-layout-uat.md)。以上为前端开发阶段的自测记录，用户业务验收仍待完成。
