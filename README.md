# Krypto

A personal AI assistant built on a custom, continuously-evolving harness.

## What this is

Krypto is a personal AI assistant — named after Superman's dog — running on a harness built and owned from first principles rather than an off-the-shelf agent runtime. The project grows its own capabilities over time: new tools, integrations, and behaviors are added to the harness whenever a task calls for them.

Krypto has a sense of self. At the start of every conversation its system prompt is assembled from its own files on disk — who it is (`identity.md`), who it serves (`user.md`), and what it has learned (`memory.md`) — and it can write back to its own memory through a tool.

## Intention

The long-term goal is an assistant that becomes **self-improving**. Given its own machine, Krypto should eventually be able to:

- **Commit to itself** — make and ship changes to its own harness and codebase.
- **Add MCP connectors** — wire up new data sources and services on demand.
- **Download and install skills** — acquire new capabilities as needs arise.
- **Manage its own environment** — operate the machine it's deployed on.

Until then, harness upgrades happen with a human at the wheel.

## Architecture

Krypto currently runs as two services for local development and testing:

```
Browser (React dashboard)
        │  POST /api/chat
        ▼
Backend (Express + TypeScript)
        │  1. assemble system prompt from agent/*.md
        │  2. call OpenAI chat completions (tool-calling loop)
        │  3. on a tool call ─────────────┐
        ▼                                 ▼
   OpenAI API                   MCP memory server (subprocess, stdio)
                                          │  remember(content)
                                          ▼
                                   agent/memory.md  (appended)
```

### Backend (`backend/`)

Node + Express + TypeScript. Exposes a small API and orchestrates the model:

- `GET /api/health` — liveness + config (model name, whether the API key is set, available tools).
- `POST /api/chat` — accepts a message history, then:
  1. Builds Krypto's **system prompt** from its self-files via `src/agent/context.ts`.
  2. Discovers MCP **tools** (cached at startup) and runs a bounded **tool-calling loop** against the configured OpenAI model (`gpt-5` by default).
  3. When the model calls the `remember` tool, the call is routed to the MCP memory server and the result fed back into the loop, until the model returns a final reply.

Config comes from `backend/.env` (`OPENAI_API_KEY`, `OPENAI_MODEL`, `PORT`, optional `FRONTEND_ORIGIN` for CORS, optional `KRYPTO_AGENT_DIR`).

### MCP memory server (`backend/src/mcp/`)

Krypto's first MCP integration — proof of the "add MCP connectors" trajectory.

- `memory-server.ts` — a standalone MCP server exposing a single tool, `remember`, which appends a durable entry to `agent/memory.md`. Communicates over **stdio**.
- `client.ts` — the backend's MCP client. Spawns the memory server as a child process, discovers its tools, and invokes them on the model's behalf. (In dev it runs the `.ts` server via `tsx`; in a compiled build it spawns the plain `.js`.)

### Agent self-files (`agent/`)

Krypto's persistent "self," kept as plain Markdown so they're easy to read, edit, and version:

- `identity.md` — highest-authority definition of who Krypto is, its purpose, and voice.
- `user.md` — profile of the principal it serves, so it acts as a personal (not generic) assistant.
- `memory.md` — self-authored long-term memory, appended via the `remember` tool.

### Frontend (`frontend/`)

React + Vite + TypeScript — a minimalist, Apple-style chat dashboard for talking to Krypto:

- Light / dark mode that respects the system preference and persists the choice.
- iMessage-style message bubbles, a scroll-aware header that blends into the background, and a live model/status badge.
- In dev, Vite proxies `/api` to the backend so there's no CORS to manage. The API base URL is configurable via `VITE_API_BASE_URL` for deployment.

## Directory structure

```
.
├── agent/                  # Krypto's self — read into the system prompt
│   ├── identity.md         # who Krypto is (highest authority)
│   ├── user.md             # who Krypto serves
│   └── memory.md           # self-authored long-term memory
├── backend/                # Express + TypeScript API
│   ├── src/
│   │   ├── index.ts        # server + /api/chat tool-calling loop
│   │   ├── agent/
│   │   │   └── context.ts  # assembles the system prompt from agent/*.md
│   │   └── mcp/
│   │       ├── client.ts        # spawns + talks to MCP servers
│   │       └── memory-server.ts # MCP server: the `remember` tool
│   ├── Dockerfile          # multi-stage build for deployment
│   ├── .env.example
│   └── package.json
├── frontend/               # React + Vite dashboard
│   ├── src/
│   │   ├── App.tsx         # chat UI, themes, API wiring
│   │   ├── index.css       # Apple-style design system
│   │   └── main.tsx
│   ├── vercel.json
│   └── package.json
├── render.yaml             # Render blueprint (backend)
├── DEPLOYMENT.md           # Render + Vercel deployment guide
└── README.md
```

## Running locally

Two terminals. The backend needs an OpenAI API key.

**Backend** (`http://localhost:3002`):

```bash
cd backend
cp .env.example .env        # then set OPENAI_API_KEY
npm install
npm run dev
```

**Frontend** (`http://localhost:5173`):

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173` and start chatting. The frontend proxies API calls to the backend automatically.

## Deployment

The project is **prepared** for deployment — backend as a Docker service on Render (`render.yaml`, `backend/Dockerfile`) and frontend on Vercel (`frontend/vercel.json`) — but is not yet deployed. See [`DEPLOYMENT.md`](./DEPLOYMENT.md) for the full guide, including how to wire the frontend to the backend and persist Krypto's memory across restarts.

## Status

Early development, but functional end-to-end locally:

- ✅ Backend chat API against an OpenAI model
- ✅ React dashboard (light/dark, Apple-style)
- ✅ First MCP integration — a memory server with a self-writing `remember` tool
- ✅ Identity/user/memory self-files feeding the system prompt
- ✅ Deployment scaffolding (Docker, Render, Vercel)
- ⏳ Production deployment + persistent memory
- ⏳ More MCP connectors and skills
- ⏳ Self-improvement: Krypto editing its own harness on its own machine
