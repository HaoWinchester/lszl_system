# KG Graph API（FastAPI 后端）

知识图谱应用的后端，FastAPI + SQLAlchemy 2.0 async + PostgreSQL + Alembic。

## 首次启动

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

# 复制环境变量（已提供 .env，按需修改）
# 运行数据库迁移
alembic upgrade head

# 启动开发服务器
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

健康检查：`curl http://127.0.0.1:8000/api/v1/health`
交互式文档：`http://127.0.0.1:8000/docs`

## 说明

- PostgreSQL（Homebrew）监听 `/tmp` Unix socket，不监听 TCP。连接串用 `?host=/tmp`，代码里 `connect_args={"host":"/tmp"}` 双保险。
- 不使用 passlib（其在 Python 3.11 + bcrypt 4.x 有兼容问题），密码 hash 直接用 `bcrypt` 库。
- Alembic 用 async 模板（`alembic init -t async`），`env.py` 运行期注入 DATABASE_URL。
