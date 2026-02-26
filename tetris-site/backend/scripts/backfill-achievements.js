/**
 * backfill-achievements.js
 *
 * One-off script: checks every existing user against all achievement
 * definitions and grants whatever they've already earned based on
 * their current stats + elo.
 *
 * Run from the backend folder:
 *   node scripts/backfill-achievements.js
 */

import { createClient } from '@supabase/supabase-js';
import { checkAndUpdateAchievements, grantRegistrationRewards } from '../src/achievements.js';
import 'dotenv/config';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

async function main() {
  // 1. Fetch all users
  const { data: users, error } = await supabase
    .from('users')
    .select('id, username, elo, created_at');

  if (error) {
    console.error('Failed to fetch users:', error.message);
    process.exit(1);
  }

  console.log(`Backfilling ${users.length} users…\n`);

  let total = 0;

  for (const user of users) {
    // 2. Grant welcome-aboard + default cosmetics to everyone
    //    (uses upsert / ignoreDuplicates so safe to re-run)
    await grantRegistrationRewards(user.id, supabase).catch(() => {});

    // 3. Run full achievement check with a neutral context
    //    — stats-based achievements (games played, lines cleared, elo, etc.)
    //      are evaluated purely from the DB stats row.
    //    — Event-triggered flags (mode === 'registered', comeback win, etc.)
    //      are intentionally left false/absent so they don't false-trigger.
    const { newlyEarned } = await checkAndUpdateAchievements(user.id, supabase, {
      mode:            'backfill', // neutral – won't match 'registered' or 'return'
      isWinner:        false,
      garbageSent:     0,
      noHold:          false,
      allClear:        false,
      rainbow:         false,
      piecesPlaced:    0,
      garbageReceived: 0,
      comebackWin:     false,
      finessePerfect:  false,
      tspinTriples:    0,
      sprintTimeMs:    0,
      currentElo:      user.elo ?? 1000,
    });

    if (newlyEarned.length > 0) {
      console.log(`  ✓ ${user.username.padEnd(20)} → earned: ${newlyEarned.join(', ')}`);
      total += newlyEarned.length;
    } else {
      console.log(`  · ${user.username}`);
    }
  }

  console.log(`\nDone. ${total} achievement(s) newly granted across ${users.length} users.`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
