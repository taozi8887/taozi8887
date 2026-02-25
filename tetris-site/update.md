git add -A ; git commit -m "Fix bugs" ; git push ; 

npx wrangler pages deploy tetris-site/frontend --project-name=tetris-frontend

cd tetris-site/backend ; npx wrangler deploy