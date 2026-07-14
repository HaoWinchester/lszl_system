"""SQLAlchemy 声明式基类。所有 ORM 模型继承 Base；Alembic 用 Base.metadata。"""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass
