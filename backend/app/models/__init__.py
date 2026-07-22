"""ORM 模型汇总。新增模型在此 import，供 Alembic autogenerate 检测。"""

from app.models.analytics import FeatureUsageEvent
from app.models.file import CurrentFile, FileContent, FileTag, Folder, GraphFile, Tag
from app.models.guided_learning import GuidedActivity, GuidedCourse, GuidedCourseActivity, GuidedLearningProgress
from app.models.question import ExamPaper, PaperQuestion, Question, QuestionBank
from app.models.runtime_state import RuntimeState
from app.models.subscription import RedeemCode, Subscription, SubscriptionOrder
from app.models.system import RoleTheme, SystemSetting
from app.models.training import CanvasWorkspace, LearningEvent, RecallProgress, TrainingProgress
from app.models.user import User, UserAdminLog

__all__ = [
    "User",
    "FeatureUsageEvent",
    "UserAdminLog",
    "RoleTheme",
    "SystemSetting",
    "Folder",
    "GraphFile",
    "FileContent",
    "Tag",
    "FileTag",
    "CurrentFile",
    "QuestionBank",
    "Question",
    "ExamPaper",
    "PaperQuestion",
    "TrainingProgress",
    "RecallProgress",
    "LearningEvent",
    "CanvasWorkspace",
    "GuidedCourse",
    "GuidedActivity",
    "GuidedCourseActivity",
    "GuidedLearningProgress",
    "RuntimeState",
]
