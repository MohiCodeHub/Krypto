# Deployment Guide

Krypto runs as two pieces:

- **Backend** — Node + Express API, deployed to **Render** as a Docker web service.
- **Frontend** — React + Vite SPA, deployed to **Vercel**.

Deploy the backend first so you have its URL for the frontend.

---

## 1. Backend → Render (Docker)

The backend is containerized via `backend/Dockerfile` (multi-stage, runs as a
non-root user, binds to the `PORT` Render injects at runtime).

### Option A: Blueprint (recommended)

1. Push this repo to GitHub.
2. In the Render dashboard: **New → Blueprint**, and point it at the repo.
   Render reads the root `render.yaml`, which declares the `krypto-backend`
   Docker web service (`dockerfilePath: ./backend/Dockerfile`,
   `dockerContext: ./backend`, health check `/api/health`).
3. When prompted, fill in the env vars marked `sync: false` (see below).
4. Apply / create the service. Render builds the image and deploys it.

### Option B: Manual Docker service

1. **New → Web Service**, connect the repo.
2. Set **Runtime / Environment** to **Docker**.
3. Set **Dockerfile Path** to `backend/Dockerfile` and **Docker Build Context
   Directory** to `backend`.
4. Set **Health Check Path** to `/api/health`.
5. Add the env vars below, then create the service.

### Env vars to set in the Render dashboard

| Variable          | Value                                                      |
| ----------------- | ---------------------------------------------------------- |
| `OPENAI_API_KEY`  | Your real OpenAI key (secret — set only in the dashboard). |
| `OPENAI_MODEL`    | `gpt-5` (or another model). Optional; defaults to `gpt-5`. |
| `FRONTEND_ORIGIN` | Your Vercel URL (set after step 2). See CORS note below.   |

> Do **not** set `PORT` — Render provides it automatically and the app reads
> `process.env.PORT`.

> **Agent self-files & memory (note):** The backend reads optional
> `identity.md` / `user.md` / `memory.md` and writes new memories to an
> `agent/` directory. By default that directory resolves outside the Docker
> build context, so in the container it lands at an **ephemeral** path that is
> wiped on each deploy/restart. The app runs fine without it (those reads fail
> soft). If you want persistent memory in production, attach a Render persistent
> disk and set `KRYPTO_AGENT_DIR` to the mounted path (e.g. `/data/agent`).

After deploy, note the public URL, e.g. `https://krypto-backend.onrender.com`.
Verify it: `https://krypto-backend.onrender.com/api/health` should return
`{ "status": "ok", ... }`.

---

## 2. Frontend → Vercel

1. In Vercel: **Add New → Project**, import the repo.
2. Set **Root Directory** to `frontend`.
3. Framework preset: **Vite** (auto-detected; `frontend/vercel.json` also
   pins it).
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
4. Add the env var below.
5. Deploy.

### Env var to set in the Vercel dashboard

| Variable             | Value                                                       |
| -------------------- | ---------------------------------------------------------- |
| `VITE_API_BASE_URL`  | The Render backend URL, e.g. `https://krypto-backend.onrender.com` |

> `VITE_*` vars are baked in at build time. If you change it, trigger a
> redeploy. Leaving it empty makes the app use relative `/api/...` paths
> (correct for local dev via the Vite proxy, but **not** for production on
> Vercel, where there is no proxy).

The included `frontend/vercel.json` adds a SPA rewrite so all routes fall back
to `index.html` for client-side routing.

---

## 3. Connect the two (CORS)

The backend restricts CORS only when `FRONTEND_ORIGIN` is set:

- **Unset** → CORS is fully open (fine for local dev).
- **Set** → only the listed origins are allowed (comma-separated for multiple).

After the frontend is live, set `FRONTEND_ORIGIN` in Render to the exact Vercel
origin (scheme + host, no trailing path), for example:

```
FRONTEND_ORIGIN=https://krypto.vercel.app
```

Multiple origins (e.g. preview + production domains):

```
FRONTEND_ORIGIN=https://krypto.vercel.app,https://www.krypto.app
```

Saving env vars on Render redeploys the service automatically.

---

## Local development (unchanged)

- Backend: `cd backend && npm install && npm run dev` (port 3002; leave
  `FRONTEND_ORIGIN` unset).
- Frontend: `cd frontend && npm install && npm run dev` (port 5173; the Vite
  proxy forwards `/api` to `http://localhost:3002`).
