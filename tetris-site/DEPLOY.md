# Testing & Deployment Guide

## Prerequisites

| Tool | Install |
|---|---|
| Node.js ≥ 18 | https://nodejs.org |
| Wrangler CLI | `npm i -g wrangler` |
| A Cloudflare account | Workers + D1 + R2 + KV enabled |

---

## Local Testing

### 1 - Install backend dependencies

```bash
cd tetris-site/backend
npm install
```

### 2 - Create local D1 database and apply schema

```bash
# One-time: creates .wrangler/state/v3/d1/ local SQLite file
wrangler d1 execute tetris-db --local --file=schema.sql

wrangler d1 execute tetris-db --local --file=migration_001_solo_stats_settings.sql
wrangler d1 execute tetris-db --local --file=migration_002_marathon_stats.sql
wrangler d1 execute tetris-db --local --file=migration_003_sprint_coop_lines.sql
wrangler d1 execute tetris-db --local --file=migration_004_matchmaking.sql
wrangler d1 execute tetris-db --local --file=migration_005_stats_expansion.sql
wrangler d1 execute tetris-db --local --file=migration_006_xp.sql
```

### 3 - Set secrets for local dev

Wrangler reads secrets from a `.dev.vars` file (never commit this).

```
# tetris-site/backend/.dev.vars
JWT_SECRET=any-random-string-32-chars-or-more
INTERNAL_KEY=any-other-random-string
```

### 4 - Start the backend dev server

```bash
# from tetris-site/backend/
wrangler dev
# Listens on http://localhost:8787
```

The `CORS_ORIGIN` in `wrangler.toml` is `https://tetris.taozi4887.dev`, which will
block requests from `localhost`. Override it for local dev in `.dev.vars`:

```
CORS_ORIGIN=http://localhost:5500
```

### 5 - Serve the frontend

Any static file server works. VS Code's **Live Server** extension is easiest:
- Install **ritwickdey.liveserver** from the Extensions panel
- Right-click `tetris-site/frontend/index.html` → **Open with Live Server**
- Default: `http://localhost:5500`

Or with Node:
```bash
npx serve tetris-site/frontend
# http://localhost:3000
```

### 6 - Test checklist

| Feature | How to test |
|---|---|
| Register | `/register.html` → fill form → should redirect to `/index.html` |
| Login | `/login.html` → cookie set → nav shows username + ELO |
| Profile | `/profile.html?u=<username>` → stats visible |
| Avatar upload | Profile page → upload button → refresh → avatar shown in header |
| Solo game | `/game.html` → Start Game → play to game over |
| Sprint | `/game.html?mode=sprint` → auto-navigates to lobby → solo sprint |
| Multiplayer | Open two browser windows → game.html → Multiplayer → same room code → play |
| Versus ELO | After versus match ends, wait 3 s → header ELO should update |
| Leaderboard | `/leaderboard.html` → filter by rank tier → search player name |
| Friends | `/friends.html` → send request to second test account → accept → challenge |
| Rank badges | Register two accounts, boost ELO via SQL, confirm badge shows correct tier |

---

## Deployment

### Step 1 - Create Cloudflare resources (first time only)

```bash
# Log in
wrangler login

# Create D1 database - note the ID it prints
wrangler d1 create tetris-db

# Create R2 bucket for avatars
wrangler r2 bucket create tetris-avatars

# Create KV namespace for rate limiting
wrangler kv namespace create RATE_KV
```

**Copy the IDs** into `backend/wrangler.toml`:
```toml
[[d1_databases]]
database_id = "<PASTE D1 ID HERE>"

[[kv_namespaces]]
id = "<PASTE KV ID HERE>"
```

### Step 2 - Apply schema to production D1

```bash
cd tetris-site/backend
wrangler d1 execute tetris-db --remote --file=schema.sql
```

### Step 3 - Set production secrets

```bash
wrangler secret put JWT_SECRET
# paste a long random string (32+ chars), press Enter

wrangler secret put INTERNAL_KEY
# paste a different random string, press Enter
```

### Step 3b - Apply any pending migrations to production D1

> **Run this before every deploy if new migration files exist in `backend/`.**

```bash
cd tetris-site/backend
wrangler d1 execute tetris-db --remote --file=migration_001_solo_stats_settings.sql
wrangler d1 execute tetris-db --remote --file=migration_002_marathon_stats.sql
wrangler d1 execute tetris-db --remote --file=migration_003_sprint_coop_lines.sql
wrangler d1 execute tetris-db --remote --file=migration_004_matchmaking.sql
wrangler d1 execute tetris-db --remote --file=migration_005_stats_expansion.sql
wrangler d1 execute tetris-db --remote --file=migration_006_xp.sql
```

### Step 4 - Deploy the backend Worker

```bash
cd tetris-site/backend
wrangler deploy
# Output: https://tetris-backend.<your-subdomain>.workers.dev
```

Then set your custom domain `api.tetris.taozi4887.dev` in the Cloudflare dashboard:
- Workers & Pages → tetris-backend → Settings → Domains & Routes → Add Custom Domain

### Step 5 - Deploy the frontend

The frontend is plain HTML/CSS/JS - no build step.

**Option A: Cloudflare Pages (recommended)**
```bash
# From repo root, deploy the frontend folder
wrangler pages deploy tetris-site/frontend --project-name tetris-frontend
```
Then add `tetris.taozi4887.dev` as a custom domain in:
- Cloudflare Dashboard → Pages → tetris-frontend → Custom Domains

**Option B: Manual via dashboard**
- Drag `tetris-site/frontend/` into Cloudflare Pages deploy UI

### Step 6 - Verify CORS origin

In `backend/wrangler.toml`, `CORS_ORIGIN` must exactly match the frontend origin:
```toml
[vars]
CORS_ORIGIN = "https://tetris.taozi4887.dev"
```
If it doesn't match, all API calls will fail with CORS errors.

### Step 7 - Smoke test production

1. Visit `https://tetris.taozi4887.dev` - landing page loads
2. Register an account - check D1 via `wrangler d1 execute tetris-db --remote --command "SELECT * FROM users LIMIT 5;"`
3. Play a solo game - no console errors
4. Play a versus match - ELO updates in header after 3 s

---

## About the file changes this session

| Old file | Status | Replacement |
|---|---|---|
| `portfolio/tetris.html` | **Deleted** | → `https://tetris.taozi4887.dev` |
| `tetris-site/frontend/game-engine.html` | **Deleted** | → `game.html` (now fully self-contained) |
| `tetris-site/frontend/game.html` | **Replaced** | Integrated game engine - no iframe |

`game.html` is now the full game page. It includes:
- The complete Tetris engine (solo + multiplayer)
- The tetris-site header with auth (avatar, rank badge, ELO)
- Direct API auth fetch - no postMessage bridge
- Auto-refreshes ELO display 2.5 s after a versus match ends
- Handles `?mode=sprint|versus|coop&room=CODE` URL params
