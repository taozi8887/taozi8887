# Taotris — tetris.taozi4887.dev

Competitive multiplayer Tetris with ELO rankings, real-time matchmaking, profiles, and leaderboards.

---

## Stack

| Layer | What |
|---|---|
| **Frontend** | Vanilla HTML / CSS / JS — static files, no build step |
| **Backend** | Node.js + Express + Socket.io |
| **Database** | Supabase (Postgres) |
| **Frontend host** | Cloudflare Pages → `tetris.taozi4887.dev` |
| **Backend host** | Any Node.js host (Railway, Render, Fly.io, VPS) → `api.tetris.taozi4887.dev` |

Supabase is the **database only** — the Node server handles all HTTP REST routes, WebSocket game rooms, matchmaking, JWT auth, and avatar uploads. It connects to Supabase using the service role key.

---

## Project structure

```
tetris-site/
  backend/
    src/
      index.js        ← Express app + Socket.io server entry point
      auth.js         ← /api/auth/* (register, login, logout, me)
      profile.js      ← /api/profile/* (get, update, avatar upload)
      stats.js        ← /api/stats/* (solo stats, match history, record match)
      friends.js      ← /api/friends/* (requests, list, challenge)
      gameroom.js     ← Socket.io game room (Durable Object equivalent)
      matchmaking.js  ← Ranked/casual matchmaking queue
      elo.js          ← ELO calculation
    .env.example      ← Required environment variables
    package.json
  frontend/
    index.html        ← Home / leaderboard preview
    game.html         ← Full game (solo + multiplayer, all modes)
    profile.html
    leaderboard.html
    friends.html
    login.html
    register.html
    controls.html
    ranks.html
    verify.html
    api.js            ← Typed fetch wrapper (points to api.tetris.taozi4887.dev)
    style.css
    cursor.js
```

---

## Local development

### 1 — Backend

```bash
cd tetris-site/backend
npm install
cp .env.example .env    # fill in your Supabase credentials
npm run dev             # node --watch src/index.js  →  http://localhost:3001
```

Required `.env` values:

```
SUPABASE_URL=https://<your-project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role key>
JWT_SECRET=<any 32+ char random string>
CLIENT_ORIGIN=http://localhost:5500
PORT=3001
```

### 2 — Frontend

Serve the `frontend/` folder with any static file server. The easiest option is VS Code Live Server (default port 5500) or:

```bash
npx serve tetris-site/frontend
```

`api.js` automatically uses `http://localhost:3001` when on localhost.

---

## Deployment

### Frontend → Cloudflare Pages

```bash
# from repo root
npx wrangler pages deploy tetris-site/frontend --project-name tetris-frontend
```

Add `tetris.taozi4887.dev` as a custom domain in Cloudflare Pages → tetris-frontend → Custom Domains.

### Backend → Node host (Railway / Render / Fly.io / VPS)

The backend is a standard Node.js app — deploy it to any host that runs persistent Node processes.

Set the following environment variables on the host:

```
SUPABASE_URL=https://<your-project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role key>
JWT_SECRET=<same value as production>
CLIENT_ORIGIN=https://tetris.taozi4887.dev
PORT=3001   (or whatever your host assigns)
```

Point the DNS record `api.tetris.taozi4887.dev` → your Node server's IP/hostname.

**Railway (quickest):**
```bash
# install Railway CLI, then:
cd tetris-site/backend
railway up
```

---

## Environment variables reference

| Variable | Where | Description |
|---|---|---|
| `SUPABASE_URL` | backend | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | backend | Service role key (bypasses RLS) |
| `JWT_SECRET` | backend | Signs HttpOnly auth cookies |
| `CLIENT_ORIGIN` | backend | Allowed CORS origin (frontend URL) |
| `PORT` | backend | HTTP listen port (default 3001) |

---

## Notes

- Auth uses **HttpOnly JWT cookies** set by the Node backend — not Supabase Auth client-side flows.
- Avatars are stored as base64 in Supabase (profiles table), served through the backend.
- Socket.io game rooms and matchmaking queue live **in Node process memory** — restarting the server ends all active games.
- `migration_007_match_boards.sql` must be run in the Supabase SQL editor to enable match board history: `ALTER TABLE matches ADD COLUMN p1_final_board TEXT; ALTER TABLE matches ADD COLUMN p2_final_board TEXT;`
