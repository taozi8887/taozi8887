/**
 * unlock-all.js
 *
 * Admin script: unlocks ALL achievements and ALL cosmetics for a given user.
 *
 * Run from the backend folder:
 *   node scripts/unlock-all.js [username]
 *   node scripts/unlock-all.js oneaboveall
 */

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const TARGET = process.argv[2] || 'oneaboveall';

async function main() {
  console.log(`\n🔓  Unlocking everything for "${TARGET}"…\n`);

  // 1. Find the user
  const { data: user, error: userErr } = await supabase
    .from('users')
    .select('id, username')
    .eq('username', TARGET)
    .single();

  if (userErr || !user) {
    console.error(`❌  User "${TARGET}" not found:`, userErr?.message || 'no data');
    process.exit(1);
  }
  console.log(`✅  Found user: ${user.username} (${user.id})`);

  // 2. Fetch all achievements
  const { data: achievements, error: achErr } = await supabase
    .from('achievements')
    .select('slug, progress_total');

  if (achErr) { console.error('❌  Failed to fetch achievements:', achErr.message); process.exit(1); }
  console.log(`📋  ${achievements.length} achievements found`);

  // 3. Upsert every achievement as earned with full progress
  const now = new Date().toISOString();
  const achRows = achievements.map(a => ({
    user_id:          user.id,
    achievement_slug: a.slug,
    progress:         a.progress_total ?? 1,
    earned:           true,
    earned_at:        now,
  }));

  const { error: achUpsertErr } = await supabase
    .from('user_achievements')
    .upsert(achRows, { onConflict: 'user_id,achievement_slug' });

  if (achUpsertErr) { console.error('❌  Failed to upsert achievements:', achUpsertErr.message); process.exit(1); }
  console.log(`✅  ${achRows.length} achievements unlocked`);

  // 4. Fetch all cosmetics
  const { data: cosmetics, error: cosErr } = await supabase
    .from('cosmetics')
    .select('slug');

  if (cosErr) { console.error('❌  Failed to fetch cosmetics:', cosErr.message); process.exit(1); }
  console.log(`📋  ${cosmetics.length} cosmetics found`);

  // 5. Grant every cosmetic
  const cosRows = cosmetics.map(c => ({
    user_id:      user.id,
    cosmetic_slug: c.slug,
  }));

  const { error: cosUpsertErr } = await supabase
    .from('user_cosmetics')
    .upsert(cosRows, { onConflict: 'user_id,cosmetic_slug', ignoreDuplicates: true });

  if (cosUpsertErr) { console.error('❌  Failed to grant cosmetics:', cosUpsertErr.message); process.exit(1); }
  console.log(`✅  ${cosRows.length} cosmetics granted`);

  console.log(`\n🎉  Done! "${TARGET}" now has everything.\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
