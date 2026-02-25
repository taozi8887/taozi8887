# tetris.taozi4887.dev

Full-featured Tetris site with user accounts, ELO rankings, profiles, live multiplayer, friends system, and challenge inbox.

## Stack
- **Frontend**: Plain HTML/CSS/JS + Cloudflare Pages
- **Backend**: Cloudflare Workers (API) + Durable Objects (live rooms)
- **Database**: Cloudflare D1 (SQLite-compatible SQL)
- **Storage**: Cloudflare R2 (profile pictures)
- **Sessions**: JWT in HTTP-only cookies (signed with HMAC-SHA256)

## Deployment

### 1. Create D1 database
```bash
cd backend
npx wrangler d1 create tetris-db
# Copy the database_id into wrangler.toml
npx wrangler d1 execute tetris-db --file=schema.sql
```

### 2. Create R2 bucket
```bash
npx wrangler r2 bucket create tetris-avatars
```

### 3. Set secrets
```bash
npx wrangler secret put JWT_SECRET          # random 32+ char string
npx wrangler secret put AVATAR_MAX_SIZE_KB  # e.g. "512"
```

### 4. Deploy backend
```bash
cd backend
npm install
npx wrangler deploy
```

### 5. Deploy frontend
Connect the `frontend/` folder to Cloudflare Pages and set the custom domain to `tetris.taozi4887.dev`.

Update `frontend/api.js` `API_BASE` to your Worker URL if needed.

## Security notes
- Passwords: PBKDF2-SHA256, 250 000 iterations, per-user salt (uses Web Crypto API - available in Workers)
- Sessions: signed JWT stored in `HttpOnly; Secure; SameSite=Strict` cookie, 30-day expiry
- Username/email inputs are sanitised and length-capped server-side
- Rate-limiting on auth endpoints via a KV-backed sliding window counter
- SQL uses parameterised queries only - no string concatenation
- Profile pictures: validated MIME type + size, served from R2 with a random key (not guessable)
- CORS: `Access-Control-Allow-Origin` set to `https://tetris.taozi4887.dev` only

## ELO ranks
| ELO Range    | Rank        | Badge colour |
|---|---|---|
| < 1000       | Unranked    | grey         |
| 1000 – 1199  | Bronze      | #cd7f32      |
| 1200 – 1399  | Silver      | #aaa         |
| 1400 – 1599  | Gold        | #ffd700      |
| 1600 – 1799  | Platinum    | #4affda      |
| 1800 – 1999  | Diamond     | #60efff      |
| 2000 – 2199  | Master      | #b46ff0      |
| 2200+        | Grandmaster | #c8ff4a      |

## Folder structure
```
tetris-site/
├── README.md
├── frontend/               ← Cloudflare Pages static site
│   ├── index.html          landing / home
│   ├── game.html           the Tetris game
│   ├── login.html
│   ├── register.html
│   ├── profile.html        public + own profile
│   ├── leaderboard.html    global ELO rankings
│   ├── friends.html        friends list + challenge inbox
│   ├── style.css           shared design system
│   └── api.js              typed fetch wrapper
└── backend/                ← Cloudflare Workers
    ├── package.json
    ├── wrangler.toml
    ├── schema.sql
    └── src/
        ├── index.js        router
        ├── auth.js         /api/auth/*
        ├── profile.js      /api/profile/*
        ├── stats.js        /api/stats/*
        ├── friends.js      /api/friends/*  /api/inbox/*
        ├── elo.js          ELO helpers
        └── gameserver.js   Durable Object for live rooms
```
