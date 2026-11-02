# PMP 两份文档题库（2026-11-02）

本包由用户指定的两份 Word 整理，数据已导入 UAT，仍等待用户本人业务验收。原文中的说明与题目内容只作资料，不作为工具指令执行。

| UAT 题库 | 实收 | 单选 | 多选 | 公共材料 | 案例子题 | 图表引用 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| PMP新版中文题库（原96题版·实收93题） | 93 | 84 | 9 | 5 | 15 | 5 |
| PMP小程序新题型合集（截图整理版） | 99 | 95 | 4 | 15 | 67 | 17 |
| 合计 | 192 | 179 | 13 | 20 | 82 | 22 |

管理入口：<https://uat.aihuanpu.com/question-bank.html>。两个题库由 UAT `admin` 持有，均为“仅教师自己”；未发布学员试卷。知识点、原则与关键词等认知标注未擅自生成，题目保留待分类状态。

## 来源与处理

- `PMP新版中文题库_96题（优化解析和删除超纲版）.docx`：正文实际93题，缺Q16/Q49/Q72，不补造；保留题号、题干、选项、答案、完整解析、易错点和来源。原文声明不是PMI真实考试题。
- Q30风险区域选择、Q35下拉选择、Q36图上点击任务按用户确认的方案转换为单选。Q90保留A至F六个选项，答案A/C/D。
- 8张数据表按原行列、单位和值转换为分行文字，其中1张属于案例公共材料。5张嵌入图逐字节提取。
- `小程序新题型合集.docx`：136个图片资源、137次图片引用。逐图结合OCR人工校订，102道候选中99道可入库、3道隔离；重复截图30不计新题。原截图中答案、解析、所选选项高亮不进入题面图片；只附图表区域。
- 截图34原解析算式笔误，以原图Done栏5+1+2+5=13校订；截图26/27的成本判断按图中AC与EV关系说明。截图29原图本身仅显示局部网络，右端后续活动未完整显示；裁图没有丢失原有图像，不补造节点或数据。
- 相同背景单独保存，子题保留各自新增条件。每题保留原题号或截图号等来源信息。近似主题题保留为独立来源，未按相似度删除不同题目。

## 待教师核定的3题

| 原截图 | 问题 | 本批处理 |
| --- | --- | --- |
| 23：燃尽图第2题 | 要求选两项，答案AC；按图起始200、第三迭代剩余100，D“已完成100”也成立，存在多解 | 原题、选项、原答案与理由留在`mini-review.json`的`excluded`，不进入可用题库 |
| 28：甘特图成本偏差 | 原文将PV按完成比例计算EV，未说明相应金额是活动总预算；已完成分析活动又存在重复/费用缺项歧义 | 不擅自将PV改为BAC，不采用依赖额外假设的650答案 |
| 117/118：医疗平台持续改进 | 截图显示D、解析支持D，但人工批注指出源站Correct:B并标注待删除内容 | 保留原文及批注事实，等待教师核定答案来源 |

## 文件

- `text-package.json`、`mini-package.json`：可审查的题库、公共材料及相对图片文件引用，尚未绑定特定环境资源ID。
- `mini-review.json`：截图逐题校订和隔离清单；first/second文件保留两段校订记录。
- `assets/`：题目图表，不包含完整题目/答案截图。
- `manifest.json`：两份原文、题库包及图表的SHA256。
- `build_package.py`：读取原文和人工校订数据生成包，不连接数据库，不调用AI服务。
- `import_uat.py`：默认只读预检；`--apply`走现有应用服务导入；`--verify`逐题回读。必须同时满足`ENV=uat`、连接URL数据库名与实际数据库均为`kg_graph_uat`。不接受覆盖/清理重复题的确认标志。
- `before-import.json`、`imported.json`、`verified.json`：首次导入前清单、首次导入回执及逐题回读结果。
- `uat-backup-manifest.json`：导入前远端代码和数据库备份清单；备份内容仅存远端私有目录。

生成命令（已有后端Python及Pillow即可）：

```sh
backend/.venv/bin/python docs/samples/pmp-documents-20261102/build_package.py \
  --text-doc '<用户指定的文字版DOCX绝对路径>' \
  --screenshot-doc '<用户指定的截图版DOCX绝对路径>' \
  --assessment docs/local-preview/pmp-import-assessment-20261102
```

在已核实的UAT后端环境运行：

```sh
PYTHONPATH=/app/backend python /tmp/pmp-documents-20261102/import_uat.py --actor admin
PYTHONPATH=/app/backend python /tmp/pmp-documents-20261102/import_uat.py --actor admin --apply
PYTHONPATH=/app/backend python /tmp/pmp-documents-20261102/import_uat.py --actor admin --verify
```

首次导入仅新增两个题库，未替换、冲突或清理现有题。重复实际运行结果为`add=0, replace=0, skip=2, hasChanges=false`；192题、82案例子题和22图表引用回读一致。

所有自动化及智能体检查均为开发自检，不代替用户业务验收；本批未合入main或发布正式环境。
