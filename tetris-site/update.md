git add -A ; git commit -m "Fix bugs" ; git push ; 

npx wrangler pages deploy tetris-site/frontend --project-name=tetris-frontend

works third time

cd tetris-site/backend ; npx wrangler deploy