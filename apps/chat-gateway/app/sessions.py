"""In-memory per-session chat state. No persistence -- prototype scope."""
import uuid
from dataclasses import dataclass, field


@dataclass
class PendingTurn:
    mutating_tool_use_id: str
    mutating_tool_name: str
    mutating_arguments: dict
    other_tool_use_blocks: list[dict] = field(default_factory=list)


@dataclass
class ChatSession:
    id: str
    history: list[dict] = field(default_factory=list)
    pending: PendingTurn | None = None


class SessionStore:
    def __init__(self) -> None:
        self._sessions: dict[str, ChatSession] = {}

    def get_or_create(self, session_id: str | None) -> ChatSession:
        if session_id and session_id in self._sessions:
            return self._sessions[session_id]
        new_id = session_id or str(uuid.uuid4())
        session = ChatSession(id=new_id)
        self._sessions[new_id] = session
        return session

    def get(self, session_id: str) -> ChatSession | None:
        return self._sessions.get(session_id)
