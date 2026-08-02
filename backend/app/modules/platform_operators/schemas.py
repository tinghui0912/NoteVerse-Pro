"""Public DTOs for control-plane authentication."""

from pydantic import BaseModel, Field

from app.db.models import OperatorRole


class OperatorLoginCommand(BaseModel):
    username: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=1, max_length=1024)


class OperatorRead(BaseModel):
    operator_id: str
    display_name: str
    role: OperatorRole
