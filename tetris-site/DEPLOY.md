```
git add . ; git commit -m "update" ; git push
```
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
