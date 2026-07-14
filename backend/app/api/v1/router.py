"""v1 API 路由聚合。"""

from fastapi import APIRouter

from app.api.v1 import auth, files, health, questions, subscriptions, system, training, users

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(system.router)
api_router.include_router(files.router)
api_router.include_router(questions.router)
api_router.include_router(training.router)
api_router.include_router(subscriptions.router)
