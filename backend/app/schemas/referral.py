"""Self-only aggregate: never expose invitee identifiers or contact details."""
from pydantic import BaseModel
from typing import Literal


class ReferralSummary(BaseModel):
    code: str | None
    registeredCount: int
    rewardedCount: int
    rewardEnabled: Literal[True] = True
    rewardDays: Literal[7] = 7
