// ─── ELO System ───────────────────────────────────────────────────
// Standard Elo formula with variable K-factor.
// Only applied for Versus and Sprint Race modes (not Co-op).

const ELO_K_NEW       = 32; // < 30 rated games
const ELO_K_REGULAR   = 16; // >= 30 games
const ELO_FLOOR       = 100; // minimum ELO (can't go below this)

export const RANKS = [
  { name: 'Challenger',  min: 2600, color: '#ffd700' },
  { name: 'Grandmaster', min: 2200, color: '#c8ff4a' },
  { name: 'Master',      min: 2000, color: '#b46ff0' },
  { name: 'Diamond',     min: 1800, color: '#60efff' },
  { name: 'Platinum',    min: 1600, color: '#4affda' },
  { name: 'Gold',        min: 1400, color: '#ffd700' },
  { name: 'Silver',      min: 1200, color: '#aaaaaa' },
  { name: 'Bronze',      min: 1000, color: '#cd7f32' },
  { name: 'Unranked',    min:    0, color: '#555560' },
];

export function getRank(elo) {
  for (const r of RANKS) {
    if (elo >= r.min) return r;
  }
  return RANKS[RANKS.length - 1];
}

/**
 * Calculate ELO delta for a match.
 * @param {number} ratingA    - player A's current ELO
 * @param {number} ratingB    - player B's current ELO
 * @param {number} scoreA     - 1 if A won, 0 if A lost, 0.5 for draw
 * @param {number} gamesA     - total rated games played by A
 * @param {number} gamesB     - total rated games played by B
 * @returns {{ deltaA: number, deltaB: number }}
 */
export function calcElo(ratingA, ratingB, scoreA, gamesA, gamesB) {
  const kA = gamesA < 30 ? ELO_K_NEW : ELO_K_REGULAR;
  const kB = gamesB < 30 ? ELO_K_NEW : ELO_K_REGULAR;

  // Expected score
  const expA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  const expB = 1 - expA;

  const scoreB = 1 - scoreA;

  const deltaA = Math.round(kA * (scoreA - expA));
  const deltaB = Math.round(kB * (scoreB - expB));

  // Clamp to floor
  const newA = Math.max(ELO_FLOOR, ratingA + deltaA);
  const newB = Math.max(ELO_FLOOR, ratingB + deltaB);

  return {
    deltaA: newA - ratingA,
    deltaB: newB - ratingB,
    newA,
    newB,
  };
}
