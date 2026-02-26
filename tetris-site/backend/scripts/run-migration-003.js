/**
 * run-migration-003.js
 * Inserts Platinum + Master rank cosmetics and achievements.
 * Run from backend folder: node scripts/run-migration-003.js
 */
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

async function run() {
  const cosmetics = [
    { slug: 'border-platinum',      type: 'border', name: 'Platinum',       rarity: 'rare',      description: 'Sweeping silver-blue arc shimmer.',            icon: '🪙' },
    { slug: 'border-master',        type: 'border', name: 'Master',         rarity: 'epic',      description: 'Dual crimson-violet spinning crown ring.',      icon: '🔮' },
    { slug: 'title-platinum-peak',  type: 'title',  name: 'Platinum Peak',  rarity: 'rare',      description: null,                                           icon: '🪙' },
    { slug: 'title-master-class',   type: 'title',  name: 'Master Class',   rarity: 'epic',      description: null,                                           icon: '🔮' },
  ];

  const { error: ce } = await supabase.from('cosmetics').upsert(cosmetics, { onConflict: 'slug', ignoreDuplicates: true });
  if (ce) { console.error('cosmetics insert failed:', ce.message); } else { console.log('✅ 4 cosmetics inserted/skipped'); }

  const achievements = [
    {
      slug: 'platinum-peak',
      name: 'Platinum Peak',
      description: 'Reach Platinum rank on the ranked ladder.',
      rarity: 'rare',
      icon: '🪙',
      progress_total: 1,
      reward_border_slug: 'border-platinum',
      reward_title_slug: 'title-platinum-peak',
    },
    {
      slug: 'masters-degree',
      name: "Master's Degree",
      description: 'Reach Master rank on the ranked ladder.',
      rarity: 'epic',
      icon: '🔮',
      progress_total: 1,
      reward_border_slug: 'border-master',
      reward_title_slug: 'title-master-class',
    },
  ];

  const { error: ae } = await supabase.from('achievements').upsert(achievements, { onConflict: 'slug', ignoreDuplicates: true });
  if (ae) { console.error('achievements insert failed:', ae.message); } else { console.log('✅ 2 achievements inserted/skipped'); }
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
