"""Static paths and settings for the chat gateway."""
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[3]
GATEWAY_ROOT = Path(__file__).resolve().parents[1]
STATIC_DIR = GATEWAY_ROOT / "static"

load_dotenv(GATEWAY_ROOT / ".env", override=True)

TSX_BIN = REPO_ROOT / "node_modules" / ".bin" / "tsx"

# All 8 MCP servers in the repo, exposed to the chat loop.
MCP_SERVER_SCRIPTS = {
    "planning-ops": REPO_ROOT / "mcp" / "planning-ops" / "src" / "index.ts",
    "oracle-epm-core": REPO_ROOT / "mcp" / "oracle-epm-core" / "src" / "index.ts",
    "fccs-close": REPO_ROOT / "mcp" / "fccs-close" / "src" / "index.ts",
    "hfm": REPO_ROOT / "mcp" / "hfm" / "src" / "index.ts",
    "data-integration-watchtower": REPO_ROOT / "mcp" / "data-integration-watchtower" / "src" / "index.ts",
    "metadata-governance": REPO_ROOT / "mcp" / "metadata-governance" / "src" / "index.ts",
    "security-audit": REPO_ROOT / "mcp" / "security-audit" / "src" / "index.ts",
    "epm-automate-wrapper": REPO_ROOT / "mcp" / "epm-automate-wrapper" / "src" / "index.ts",
}

ANTHROPIC_MODEL = "claude-sonnet-5"
MAX_TOKENS = 2048
