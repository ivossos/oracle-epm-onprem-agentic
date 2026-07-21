from pydantic import BaseModel


class ChatRequest(BaseModel):
    session_id: str | None = None
    message: str


class ApproveRequest(BaseModel):
    session_id: str
    tool_call_id: str
    approved: bool


class ChatResponse(BaseModel):
    session_id: str
    messages: list[dict]
    status: str | None = None
    tool_call: dict | None = None
