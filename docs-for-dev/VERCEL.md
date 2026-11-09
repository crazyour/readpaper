# Deploying the web app to Vercel

Vercel runs **only** the Next.js frontend in `web/`. The DeepTutor backend is a
Python service (FastAPI + SQLite + model calls + local subprocesses) and has to
run on a normal host — Fly.io, Railway, Render, a VPS, or the bundled Docker
image. The frontend talks to it through a server-side proxy, so the browser
never needs a CORS preflight for ordinary requests.

The Vercel build intentionally exposes only the paper study trainer, its file
previews, and the authentication endpoints it may need. Full-workspace routes
such as `/chat`, `/settings`, `/paper-quiz`, `/ws`, and their APIs return 404.
Set `DEEPTUTOR_PAPER_ONLY=true` to apply the same focused surface on another
frontend host; Vercel enables it automatically.

```
browser ──► https://your-app.vercel.app  (Next.js, Vercel)
                │  proxy.ts rewrites /api/* and /files/*
                ▼
            https://api.example.com      (FastAPI, your host)
```

## 1. Deploy the backend first

You need a public **HTTPS** address for the API. Plain `http` will be blocked by
the browser as mixed content, and the paper upload (see below) goes straight
from the browser to that address.

```bash
# On the backend host, from the repo root
python -m pip install -r requirements/full.txt
python -m pip install -e . --no-deps
deeptutor serve --port 8001          # bind 0.0.0.0, put HTTPS in front
```

Keep `data/user/` on persistent storage: it holds the model catalog, the
trainer database (`paper_trainer/trainer.sqlite3`) and stored attachments.

> **Public deployments need auth.** With no auth the API answers any origin and
> any visitor, which spends the model credits configured in
> `data/user/settings/model_catalog.json`. Enable it before you share the URL:
> `data/user/settings/auth.json` → `"enabled": true`, then set
> `CORS_ORIGINS=https://your-app.vercel.app` in the backend environment so the
> credentialed cross-origin upload is allowed.

## 2. Create the Vercel project

| Setting | Value |
| --- | --- |
| Repository | this repo |
| **Root Directory** | `web` |
| Framework Preset | Next.js (detected) |
| Install Command | `npm ci --legacy-peer-deps` (from `web/vercel.json`) |
| Build Command | `npm run build` (from `web/vercel.json`) |
| Node.js Version | 22.x (`engines.node` in `web/package.json`) |

The build goes through `web/scripts/build.mjs`, which already detects
`VERCEL === "1"`: it skips the Webpack/standalone packaging that only the
self-hosted launcher needs.

## 3. Environment variables

Set these in **Project → Settings → Environment Variables** (Production and
Preview):

| Variable | Purpose |
| --- | --- |
| `DEEPTUTOR_API_BASE_URL` | `https://api.example.com` — where the Next server proxies `/api/*`, `/files/*` and `/ws`. Required. |
| `NEXT_PUBLIC_API_BASE` | The same URL. Inlined into the browser bundle; used to send large uploads straight to the API. Falls back to `DEEPTUTOR_API_BASE_URL`. |
| `NEXT_PUBLIC_AUTH_ENABLED` | `true` when the backend runs with auth, so the proxy enforces the login gate. |
| `DEEPTUTOR_AUTH_ENABLED` | Same value; read by `proxy.ts` at request time. |

A checkout deployed without its sibling `data/` directory has no
`data/user/settings/*.json`, so every value must come from the environment —
`next.config.js` deliberately leaves `NEXT_PUBLIC_API_BASE` empty instead of
baking in `http://localhost:8001`.

## 4. What works, and what does not

**Works**

- The paper study trainer (`/research-plan`, also `/`): REST only —
  upload, grade, hint, advance, summary.
- `/files/attachments/*` previews and the authentication endpoints needed to
  protect the trainer.

**Does not work on Vercel**

- **WebSocket turns** (`/ws`). Serverless functions cannot hold a WebSocket, so
  `/chat`, `deep_solve`, `deep_research` and the other streaming capabilities
  need a host that runs a long-lived Node process (`deeptutor start`, Docker, a
  VPS). These routes are not exposed by the focused Vercel deployment.
- **Uploads above 4.5 MB through the frontend.** Vercel caps a Serverless
  Function request body at 4.5 MB. `uploadPaper()` therefore posts to
  `NEXT_PUBLIC_API_BASE` directly whenever it is an absolute, cross-origin URL
  (see `web/lib/backend-public-base.ts`), which is why step 3 requires it.
  Without that variable, papers under ~4.5 MB still work through the proxy.

## 5. Verify the deployment

```bash
# The app is up and the shell renders
curl -I https://your-app.vercel.app/research-plan

# The proxy reaches FastAPI (404 is the correct answer for an unknown paper)
curl -s https://your-app.vercel.app/api/paper-trainer/papers/nope

# The API is reachable from the browser's origin (CORS preflight)
curl -i -X OPTIONS https://api.example.com/api/paper-trainer/papers \
  -H 'Origin: https://your-app.vercel.app' \
  -H 'Access-Control-Request-Method: POST' | head -20
```

Then upload a paper in the UI: both columns should open, and a submit should
return feedback with cited passages.
