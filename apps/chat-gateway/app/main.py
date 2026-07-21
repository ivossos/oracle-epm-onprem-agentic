from contextlib import asynccontextmanager

import anthropic
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .agent_loop import resume_after_approval, run_turn
from .config import STATIC_DIR
from .mcp_pool import McpToolPool
from .schemas import ApproveRequest, ChatRequest, ChatResponse
from .sessions import SessionStore

pool = McpToolPool()
store = SessionStore()
anthropic_client = anthropic.Anthropic()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await pool.connect()
    yield
    await pool.close()


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.post("/api/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    session = store.get_or_create(req.session_id)
    session.history.append({"role": "user", "content": req.message})
    result = await run_turn(session, anthropic_client, pool)
    return ChatResponse(session_id=session.id, messages=session.history, **result)


@app.post("/api/approve", response_model=ChatResponse)
async def approve(req: ApproveRequest):
    session = store.get(req.session_id)
    if session is None:
        raise HTTPException(404, "Unknown session_id.")
    if session.pending is None or session.pending.mutating_tool_use_id != req.tool_call_id:
        raise HTTPException(409, "No matching pending approval for this session.")
    result = await resume_after_approval(session, req.approved, anthropic_client, pool)
    return ChatResponse(session_id=session.id, messages=session.history, **result)
