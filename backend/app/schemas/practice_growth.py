from typing import Literal

from pydantic import BaseModel


class PracticeGrowthGoalUpdate(BaseModel):
    goal: Literal[5, 10, 20, 30]
