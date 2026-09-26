"""Teacher-private conversations and durable, bounded background operations."""
from datetime import datetime
from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base

class TeacherAssistantSession(Base):
    __tablename__='teacher_assistant_sessions'
    id: Mapped[str]=mapped_column(String(64),primary_key=True)
    owner_id: Mapped[str]=mapped_column(ForeignKey('users.username',ondelete='CASCADE'),index=True)
    title: Mapped[str]=mapped_column(String(200),default='新的整理任务')
    messages: Mapped[list]=mapped_column(JSONB,default=list)
    plan: Mapped[dict]=mapped_column(JSONB,default=dict)
    receipt: Mapped[dict]=mapped_column(JSONB,default=dict)
    revision: Mapped[int]=mapped_column(Integer,default=1)
    created_at: Mapped[datetime]=mapped_column(DateTime(timezone=True),server_default=func.now())
    updated_at: Mapped[datetime]=mapped_column(DateTime(timezone=True),server_default=func.now(),onupdate=func.now())

class TeacherAssistantUpload(Base):
    __tablename__='teacher_assistant_uploads'
    id: Mapped[str]=mapped_column(String(64),primary_key=True)
    session_id: Mapped[str]=mapped_column(ForeignKey('teacher_assistant_sessions.id',ondelete='CASCADE'),index=True)
    name: Mapped[str]=mapped_column(String(255))
    size: Mapped[int]=mapped_column(Integer)
    digest: Mapped[str]=mapped_column(String(64))
    status: Mapped[str]=mapped_column(String(24),default='uploaded')
    extracted: Mapped[dict]=mapped_column(JSONB,default=dict,deferred=True)
    warnings: Mapped[list]=mapped_column(JSONB,default=list)
    created_at: Mapped[datetime]=mapped_column(DateTime(timezone=True),server_default=func.now())

class TeacherAssistantJob(Base):
    __tablename__='teacher_assistant_jobs'
    __table_args__=(UniqueConstraint('session_id','request_id',name='uq_teacher_assistant_operation'),)
    id: Mapped[str]=mapped_column(String(64),primary_key=True)
    session_id: Mapped[str]=mapped_column(ForeignKey('teacher_assistant_sessions.id',ondelete='CASCADE'),index=True)
    owner_id: Mapped[str]=mapped_column(ForeignKey('users.username',ondelete='CASCADE'),index=True)
    request_id: Mapped[str]=mapped_column(String(80))
    kind: Mapped[str]=mapped_column(String(24))
    status: Mapped[str]=mapped_column(String(24),default='queued',index=True)
    payload: Mapped[dict]=mapped_column(JSONB,default=dict)
    error: Mapped[str]=mapped_column(Text,default='')
    attempts: Mapped[int]=mapped_column(Integer,default=0)
    lease_until: Mapped[datetime|None]=mapped_column(DateTime(timezone=True),nullable=True)
    created_at: Mapped[datetime]=mapped_column(DateTime(timezone=True),server_default=func.now())
    updated_at: Mapped[datetime]=mapped_column(DateTime(timezone=True),server_default=func.now(),onupdate=func.now())
