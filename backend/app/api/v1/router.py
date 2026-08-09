"""v1 API 路由聚合。"""

from fastapi import APIRouter

from app.api.v1 import (
    analytics,
    auth,
    engagement,
    files,
    guided_learning,
    health,
    learning,
    question_catalog,
    questions,
    subscriptions,
    system,
    training,
    users,
)

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(system.router)
api_router.include_router(files.router)
api_router.include_router(questions.router)
api_router.include_router(question_catalog.router)
api_router.include_router(training.router)
api_router.include_router(learning.router)
api_router.include_router(guided_learning.router)
api_router.include_router(subscriptions.router)
api_router.include_router(analytics.router)
api_router.include_router(engagement.router)
