# new-legacy 更新、验收与回滚

## 当前运行方式

项目现在只有一套前端：`new-legacy` 原版 HTML、CSS、JavaScript。FastAPI 同源提供页面、静态资源和 `/api/v1`，不再启动 React、Vite 或 iframe 宿主。

```bash
./scripts/dev.sh
```

统一访问地址：`http://127.0.0.1:5173`。

当前验收账号如下，密码均为 `111111`：

| 账号 | 角色 |
|---|---|
| `佩奇007` | 管理员 |
| `老师` | 教师/教研 |
| `学生` | 学员 |
| `乔治008` | 游客/只读 |

## 收到新版后的标准操作

新版必须是一个完整的 `new-legacy` 目录，不能只给变化文件。目录内的 `VERSION` 必须使用新的唯一版本号；相同版本号但内容不同会被拒绝，以免无法准确回滚。

把新版目录放到仓库的 `new-legacy/` 后执行：

```bash
./manage-new-legacy inspect ./new-legacy
./manage-new-legacy update ./new-legacy
./manage-new-legacy status
```

`update` 会完成以下保护：

1. 检查 `VERSION`、必需页面、核心脚本和 Activity Schema。
2. 扫描新增业务存储键；未登记的新数据结构会停止升级，不切换正式版本。
3. 计算上游完整 SHA-256 和当前适配器 SHA-256。
4. 在独立临时目录复制上游快照并生成后端直连站点。
5. 检查关键脚本注入位置；上游结构发生破坏性变化时失败关闭。
6. 自动运行后端、前端、基础账号冒烟、五角色深度回归和桌面/移动端像素对比。
7. 全部通过后才原子切换 `current.json`，不会覆盖上一成功版本。

测试失败时会生成 `<VERSION>/validation.json` 并保留候选目录，`current.json` 不会变化。`--skip-browser` 仅供项目首次引导和发布管理器自身测试使用，日常更新不要使用。

升级成功后浏览器强制刷新即可，不需要重启 FastAPI。候选/历史版本可以只读查看：

```text
http://127.0.0.1:5173/__preview/<VERSION>/
```

生产业务数据保存在 PostgreSQL 的账号隔离状态中，清浏览器缓存不会删除业务数据。登录会话只使用后端签名 Cookie 和当前标签页的临时会话信息。

## 升级后的验收

运行自动测试：

```bash
cd backend
.venv/bin/python -m pytest tests/ -q

cd ../frontend
pnpm test
python3 e2e/new_legacy_smoke.py
python3 e2e/full_role_regression.py --group all
```

浏览器测试覆盖学习模式到自由模式、登录、数据库刷新持久化、管理员真实账号增删、全部稳定页面地址、角色权限以及无 iframe。五角色回归会自动确保 `全测管理员0721`、`全测教师0721`、`全测学生基础0721`、`全测学生进阶0721`、`全测游客0721` 存在，密码统一为 `111111`，并在测试后恢复被改动的图谱/题库运行数据。

需要做原版像素对比时，另开终端提供未经集成的上游目录：

```bash
cd new-legacy
python3 -m http.server 8011 --bind 127.0.0.1
```

再运行：

```bash
python3 frontend/e2e/direct_new_legacy_visual.py \
  --integrated http://127.0.0.1:5173 \
  --raw http://127.0.0.1:8011
```

## 一键回滚

如果升级后发现问题：

```bash
./manage-new-legacy rollback
./manage-new-legacy status
```

回滚只原子切换到上一个成功前端版本，不删除新版目录，也不回退或清除 PostgreSQL 业务数据；刷新浏览器后立即生效。修复后的上游必须使用新的 `VERSION` 再次更新。

## 失败时如何判断

- `缺少必需文件`：新版交付不完整，请重新提供完整目录。
- `未登记的业务存储键`：新版增加了数据结构，需要先同时更新后端 allowlist、迁移/适配逻辑和契约测试。
- `脚本顺序已变化`：上游改变了认证、用户管理或训练入口，必须复核适配器注入点。
- `相同版本号的文件内容不同`：修改新版的 `VERSION`，不要覆盖同名历史版本。
- `已有更新正在执行`：等待当前更新结束；锁文件用于阻止两个升级同时切换版本。

任何构建或兼容性检查失败都发生在切换 `current.json` 之前，当前正式站点会保持不变。

## 数据备份

普通纯前端版本更新不会执行数据库迁移。若某个新版确实需要新增表或字段，先单独备份 PostgreSQL，再执行向后兼容迁移；数据库迁移不得塞进 `new-legacy` 目录或依赖前端回滚来恢复。

本地数据库备份示例：

```bash
mkdir -p backups
pg_dump -h /tmp -U menghao -d kg_graph_dev -Fc \
  -f "backups/kg_graph_dev-$(date +%Y%m%d-%H%M%S).dump"
```
