# 内容包发布与本地来源修复

`publication.py` 是 PMP30 与新18套共用的读取、计划、应用实现。依赖只有 Python 标准库和运行后端已有的依赖；不需要作者 JS、前端或学习包导出器。包内 `publish-uat.py` / `import-local.py` 是薄入口。

所有命令默认只读；`--apply` 才写入。已有文件/出版物的归属、状态、来源键、名称和内容必须一致，整批预检发现冲突即停止。新建源为隐藏的 `builtin-template`，不创建个人导入原件，不选择当前文件，也不改变已加载的个人副本。已有匹配出版物仅补分类，不创建新版本。发布调用现有文件/模板服务，内部 commit 延迟为 flush，整批持有既有 advisory lock，成功后一次提交，失败全部回滚。已有源文件还加行锁，防止同时保存。

目录中的分类为持久 ID；只有准确的旧包 `pmp8-knowledge-graphs-20261025` 将原中文子主题映射为 `pmp`。旧目录/图/ZIP 字节保持不变。新包说明来自各专题自己的原创教学描述。

## 离线校验

仓库根目录，可用系统 Python，不连接数据库：

```sh
python3 内置数据/PMP8知识图谱/publish-uat.py --check-package
python3 内置数据/项目管理基础图谱/publish-uat.py --check-package
```

读取器校验完整数量、唯一 ID/名称/来源键、路径及 symlink 边界、节点唯一性、端点、分类、包身份和可选图/ZIP 哈希，拒绝私有资源。ZIP 哈希存在时必须一起提供 `packages/`。

## 本地开发库

从仓库根目录进入 `backend/`，使用 `.venv/bin/python`。必须在进程中显式设置 `ENV=dev`，且配置数据库和 SQL `current_database()` 均为 `kg_graph_dev`。`--base-url` 仅兼容旧 CLI 的本地 origin 校验，必须为纯 HTTP 回环地址；工具不发送 HTTP 请求，因此不存在跟随配置重定向到远端的路径。`--username` 是 `--owner` 的别名，必须为已有 active admin。无需密码。

```sh
cd backend
ENV=dev .venv/bin/python ../内置数据/项目管理基础图谱/import-local.py --username admin --report ../docs/local-preview/new18-plan.json
# 审核计划后显式应用；再运行一次应 created=0、unchanged=18。
ENV=dev .venv/bin/python ../内置数据/项目管理基础图谱/import-local.py --username admin --apply --report ../docs/local-preview/new18-applied.json
```

旧 `--refresh-visuals` 现在明确报错：隐藏库源不能经个人文件 API 刷新；有意更新内容/视觉必须走单独审核的版本发布流程。本工具只创建或确认不可变内容，不覆盖旧源。

## 精确修复旧本地 receipt

仅接受显式 `--repair-receipt`，只作用于该 receipt 中完整且唯一的 topic/file/template ID。必须匹配 owner、文件夹、当前版本号及源身份，原件与不可变快照的 nodes/links/elements/tables/strokes/resources 和四个基础 meta 字段（title/subject/audience/description）逐项完全相等，快照必须含准确 contentPackageId。只容忍已确认的编辑器保存差异：空集合省略、作者 meta 丢弃和顶层 defaults 添加；不放宽卡片/连线内容。任一编辑/身份冲突整批中止。更改仅为 GraphFile.source/source_file_id 和模板 category，显式保留 updated_at；正文、defaults、学习状态、revision、所有版本、时间戳、个人副本和当前指针均不改动。

只读检查无需备份：

```sh
# 当前目录 backend/
ENV=dev .venv/bin/python ../内置数据/PMP8知识图谱/import-local.py --username admin --repair-receipt ../docs/local-preview/pmp8/local-import.json --report ../docs/local-preview/pmp-repair-plan.json
```

`--apply` 必须提供新备份证据。证据 JSON 精确形状如下；path 必须为 dump 的绝对路径，createdAt 必须带 UTC offset。非空文件 SHA256 必须匹配、证据时间在过去一小时内、文件 mtime 与证据时间相差不超过5分钟，`pg_restore --list` 必须成功且 archive header 的 dbname 必须准确为 kg_graph_dev。不接受只有路径或人工标记 verified 的文件。

```json
{"path":"/absolute/path/dev.dump","database":"kg_graph_dev","createdAt":"2026-10-26T08:00:00+00:00","sha256":"64位小写SHA256"}
```

示例备份和证据生成（当前目录 backend/；每次使用全新目录，不覆盖既有备份）：

```sh
TASK_BACKUP_DIR="$(pwd)/../docs/local-preview/template-library-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$TASK_BACKUP_DIR"
pg_dump -Fc -h /tmp -U menghao -d kg_graph_dev -f "$TASK_BACKUP_DIR/dev.dump"
TASK_BACKUP_DIR="$TASK_BACKUP_DIR" .venv/bin/python - <<'PY'
from datetime import datetime, timezone
import hashlib, json, os, subprocess
from pathlib import Path
folder=Path(os.environ['TASK_BACKUP_DIR']).resolve()
dump=folder/'dev.dump'
assert dump.stat().st_size>0
listing=subprocess.run(['pg_restore','--list',str(dump)],check=True,capture_output=True,text=True).stdout
assert ';     dbname: kg_graph_dev' in listing.splitlines()
(folder/'backup-evidence.json').write_text(json.dumps({'path':str(dump),'database':'kg_graph_dev','createdAt':datetime.now(timezone.utc).isoformat(),'sha256':hashlib.sha256(dump.read_bytes()).hexdigest()},indent=2)+'\n')
PY
ENV=dev .venv/bin/python ../内置数据/PMP8知识图谱/import-local.py --username admin --repair-receipt ../docs/local-preview/pmp8/local-import.json --backup-evidence "$TASK_BACKUP_DIR/backup-evidence.json" --apply --report "$TASK_BACKUP_DIR/pmp-repaired.json"
```

重复修复应 repaired=0；之后旧包普通导入应 created=0、unchanged=30。普通导入仍严格核对不可变快照 digest，并只对已修复旧包源接受上述语义归一化。

## UAT / 正式数据库

远端操作必须先遵守仓库备份、UAT 人工验收与正式授权要求。以下仅为调用方法，不表示已执行或获得正式授权。无需站点构建/重启/迁移。

把以下布局复制到运行后端容器的临时目录（两个内容包按需复制）；读取器会核对新包 ZIP，所以不能省略 packages：

```text
/tmp/template-packages/
  shared/publication.py
  PMP8知识图谱/{publish-uat.py,catalog.json,graphs/,packages/}
  项目管理基础图谱/{publish-uat.py,catalog.json,graphs/,packages/}
```

在容器原后端工作目录、使用容器现有 Python（已有 app 可导入）执行。默认仅 UAT，ENV 和配置/当前数据库必须准确匹配：

```sh
python /tmp/template-packages/项目管理基础图谱/publish-uat.py --owner admin --report /tmp/new18-plan.json
python /tmp/template-packages/项目管理基础图谱/publish-uat.py --owner admin --apply --report /tmp/new18-applied.json
# 旧PMP核对并仅补分类，不产生新版本
python /tmp/template-packages/PMP8知识图谱/publish-uat.py --owner admin --report /tmp/pmp-plan.json
python /tmp/template-packages/PMP8知识图谱/publish-uat.py --owner admin --apply --report /tmp/pmp-applied.json
# 正式环境必须显式指定；仅在已授权并完成备份之后
python /tmp/template-packages/项目管理基础图谱/publish-uat.py --environment prod --owner admin --report /tmp/new18-prod-plan.json
python /tmp/template-packages/项目管理基础图谱/publish-uat.py --environment prod --owner admin --apply --report /tmp/new18-prod-applied.json
```

也可以只复制 shared/publication.py（独立 helper）和包数据，从后端工作目录执行 `python /tmp/template-packages/shared/publication.py --package /tmp/template-packages/项目管理基础图谱 ...`。远端入口拒绝 dev；本地入口拒绝 UAT/prod，不接受 DB override 参数。
