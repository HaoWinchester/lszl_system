"""ORM 模型汇总。新增模型在此 import，供 Alembic autogenerate 检测。"""

from app.models.analytics import FeatureUsageEvent
from app.models.content_prep import (
    ContentPrepDraft,
    Principle,
    QuestionAuditLog,
    QuestionBankCollaborator,
    QuestionEditLock,
    QuestionTagConfig,
    QuestionUploadBatch,
    SynthesisPreset,
)
from app.models.file import CurrentFile, FileContent, FileTag, Folder, GraphFile, Tag
from app.models.guided_learning import GuidedActivity, GuidedCourse, GuidedCourseActivity, GuidedLearningProgress
from app.models.question import (
    ExamPaper,
    PaperQuestion,
    Question,
    QuestionBank,
    QuestionCleanupAudit,
)
from app.models.runtime_state import RuntimeState
from app.models.shared_runtime_state import SharedRuntimeState
from app.models.subscription import RedeemCode, Subscription, SubscriptionOrder
from app.models.subject_facet import SubjectFacetSchema
from app.models.system import RoleTheme, SystemSetting
from app.models.training import (
    CanvasWorkspace,
    LearningEvent,
    PracticeMistake,
    PracticeVerification,
    RecallProgress,
    TrainingProgress,
)
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
    "QuestionBankCollaborator",
    "ContentPrepDraft",
    "Question",
    "Principle",
    "SynthesisPreset",
    "QuestionTagConfig",
    "QuestionEditLock",
    "QuestionUploadBatch",
    "QuestionAuditLog",
    "ExamPaper",
    "PaperQuestion",
    "QuestionCleanupAudit",
    "TrainingProgress",
    "RecallProgress",
    "LearningEvent",
    "PracticeMistake",
    "PracticeVerification",
    "CanvasWorkspace",
    "GuidedCourse",
    "GuidedActivity",
    "GuidedCourseActivity",
    "GuidedLearningProgress",
    "RuntimeState",
    "SharedRuntimeState",
    "SubjectFacetSchema",
]
