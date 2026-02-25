# Deploy Guide — tetris.taozi4887.dev

Both Railway (backend) and Cloudflare Pages (frontend) auto-deploy when you push
to GitHub. Almost every update is just a `git push`.

---

## Routine Update (99% of the time)

```bash
cd "C:\Users\edwar\Downloads\portfolio"

git add .
git status
# ↑ review what's staged — make sure no .env or node_modules appear

git commit -m "your message here"
git push
```

Railway and Cloudflare Pages pick up the push automatically within ~1 minute.

---

## First-Time Setup (one time only)

### 1. Create the GitHub repo
Go to github.com → New repository → **do NOT initialise with README**.

### 2. Initialise and push

```bash
cd "C:\Users\edwar\Downloads\portfolio"

git init
git add .
git status
# ↑ verify no secrets show up before continuing

git commit -m "initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

### 3. Connect Railway (backend)
1. railway.app → New Project → Deploy from GitHub repo
2. Select your repo
3. Set **Root Directory** → `tetris-site/backend`
4. Add env vars under Settings → Variables:

| Key | Value |
|-----|-------|
| `SUPABASE_URL` | your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | your Supabase service role key |
| `JWT_SECRET` | long random string |
| `CLIENT_ORIGIN` | `https://tetris.taozi4887.dev` |
| `PORT` | `3001` |

5. Settings → Networking → Add Custom Domain → type `api.tetris.taozi4887.dev`
   - Railway will ask **"What port is your app listening on?"** → enter **`3001`**
   - After saving, Railway shows a CNAME target like `xxxxxxx.up.railway.app` — copy it
6. Copy that CNAME target for the next step

### 4. Add DNS in Cloudflare (taozi4887.dev → DNS)
| Type | Name | Target | Proxy |
|------|------|--------|-------|
| CNAME | `api` | `xxxxxxx.up.railway.app` | **Grey cloud (DNS only)** |

### 5. Connect Cloudflare Pages (frontend)
1. Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git
2. Select your repo
3. Settings:
   - Root directory: `tetris-site/frontend`
   - Build command: *(blank — plain HTML, no build)*
   - Build output directory: *(blank)*
4. Deploy → Pages project → Custom Domains → `tetris.taozi4887.dev`
   (Cloudflare auto-adds the DNS record since the domain is already there)

### 6. Run DB migration (Supabase SQL Editor, one time)
```sql
ALTER TABLE matches ADD COLUMN p1_final_board TEXT;
ALTER TABLE matches ADD COLUMN p2_final_board TEXT;
```

---

## Updating Environment Variables

Railway only — done in the Railway dashboard (Settings → Variables).
Never put secrets in code or commit them.

After changing env vars, Railway redeploys automatically.

---

## Checking Deploy Status

- **Frontend**: Cloudflare dashboard → Workers & Pages → tetris → Deployments
- **Backend**: Railway dashboard → your project → Deployments tab
- **Live check**: `https://api.tetris.taozi4887.dev` should respond (not time out)

---

## Emergency: Force Redeploy Without a Code Change

**Frontend (Cloudflare Pages):**
Workers & Pages → tetris → Deployments → latest → Retry deployment

**Backend (Railway):**
Railway dashboard → your service → Deployments → Redeploy

---

## What's NOT in Git (secrets stay local)

Covered by `.gitignore` at the repo root:

```
.env  /  .env.*  /  .dev.vars          ← all secret files
node_modules/                           ← dependencies (npm install reinstalls)
dist/  build/                           ← build outputs
.wrangler/                              ← Cloudflare local state
```

**Never** paste `SUPABASE_SERVICE_ROLE_KEY` or `JWT_SECRET` into any file
that gets committed. Set them only in Railway's Variables panel.
