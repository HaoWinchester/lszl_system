# 佩奇老师（幻谱知识图谱）后端镜像
# 同时承载 new-legacy 前端页面（active_release）+ /api/v1 接口，单进程一站式 serve。
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# 依赖单层，利用 docker 缓存
COPY backend/requirements.txt /app/backend/requirements.txt
ARG PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
RUN pip install --no-cache-dir --index-url "$PIP_INDEX_URL" -r /app/backend/requirements.txt

# 后端代码 + new-legacy 已构建产物（前端页面/静态资源）+ seed 课程数据
COPY backend/ /app/backend/
COPY frontend/new-legacy-runtime/ /app/frontend/new-legacy-releases/
COPY frontend/public/new-legacy/ /app/frontend/public/new-legacy/

WORKDIR /app/backend
EXPOSE 8000

# 启动前先跑迁移；失败则容器退出，由 compose 按重启策略重试
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000"]
