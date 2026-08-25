from fastapi.testclient import TestClient

from app.main import app
from app.models.guided_learning import GuidedCourse, GuidedLearningProgress


def test_guided_learning_api_is_not_mounted() -> None:
    mounted_paths = {route.path for route in app.routes}
    assert not any(path.startswith("/api/v1/guided-learning") for path in mounted_paths)
    assert TestClient(app).get("/api/v1/guided-learning/courses/default").status_code == 404


def test_historical_guided_learning_tables_remain_mapped() -> None:
    assert GuidedCourse.__tablename__ == "guided_courses"
    assert GuidedLearningProgress.__tablename__ == "guided_learning_progress"
