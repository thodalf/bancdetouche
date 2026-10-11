import { LEAGUE_NATIONALITY_BIAS, NAME_POOLS, NamePool } from '../data/names.data';
import { emptyStats, Player, Position, SquadStatus } from '../models';
import { Rng } from './rng';
import { expectedWage } from './valuation';

/** Composition type d'un effectif généré (24 joueurs). */
export const SQUAD_TEMPLATE: Position[] = [
  'GK', 'GK', 'GK',
  'CB', 'CB', 'CB', 'CB', 'LB', 'LB', 'RB', 'RB',
  'DM', 'DM', 'CM', 'CM', 'CM', 'LM', 'RM', 'AM',
  'LW', 'RW', 'ST', 'ST', 'ST',
];

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function randomAge(rng: Rng): number {
  const r = rng.next();
  if (r < 0.12) return rng.int(17, 20);
  if (r < 0.45) return rng.int(21, 25);
  if (r < 0.82) return rng.int(26, 30);
  return rng.int(31, 35);
}

function potentialFor(rng: Rng, age: number, rating: number): number {
  const room = age <= 20 ? rng.int(6, 22) : age <= 23 ? rng.int(3, 14) : age <= 26 ? rng.int(0, 6) : 0;
  return clamp(rating + room, rating, 94);
}

export interface PlayerSpec {
  id: string;
  position: Position;
  meanRating: number;
  clubId: string | null;
  age?: number;
  /** Pays du championnat : les noms et nationalités suivent ses habitudes de recrutement. */
  country?: string;
}

const poolWeightCache = new Map<string, number[]>();
/** Poids des réservoirs de noms pour un pays de championnat. */
function poolWeights(country = 'FRA'): number[] {
  let w = poolWeightCache.get(country);
  if (!w) {
    const bias = LEAGUE_NATIONALITY_BIAS[country] ?? {};
    w = NAME_POOLS.map((p) => p.weight * (bias[p.nationality] ?? 1));
    poolWeightCache.set(country, w);
  }
  return w;
}

export function pickNamePool(rng: Rng, country?: string): NamePool {
  const weights = poolWeights(country);
  return rng.weighted(NAME_POOLS.map((pool, i) => ({ pool, w: weights[i] })), (x) => x.w).pool;
}

export function createPlayer(rng: Rng, spec: PlayerSpec): Player {
  const pool = pickNamePool(rng, spec.country);
  const age = spec.age ?? randomAge(rng);
  // Les très jeunes et les vétérans sont légèrement en dessous de la moyenne.
  const agePenalty = age <= 20 ? -5 : age >= 33 ? -2 : 0;
  const rating = Math.round(clamp(rng.normal(spec.meanRating + agePenalty, 6), 42, 92));
  const potential = potentialFor(rng, age, rating);
  return {
    id: spec.id,
    firstName: rng.pick(pool.first),
    lastName: rng.pick(pool.last),
    nationality: pool.nationality,
    age,
    position: spec.position,
    rating,
    potential,
    form: Math.round(rng.float(4, 7) * 10) / 10,
    fatigue: 0,
    morale: rng.int(55, 75),
    injuryWeeks: 0,
    injury: null,
    wage: expectedWage({ rating, age, potential }),
    contractYears: rng.int(1, 5),
    squadStatus: 'rotation',
    releaseClause: null,
    clubId: spec.clubId,
    youth: false,
    homegrownClubId: null,
    transferListed: false,
    recentApps: [],
    talksBlockedUntil: 0,
    stats: emptyStats(),
  };
}

/** Statut « naturel » d'un joueur selon son rang dans l'effectif (par note). */
export function statusForRank(rank: number, age: number): SquadStatus {
  if (rank < 3) return 'key';
  if (rank < 11) return 'regular';
  if (age <= 20) return 'prospect';
  if (rank < 16) return 'rotation';
  return 'backup';
}

/** Attribue un statut cohérent à tout un effectif (création de partie, clubs IA). */
export function assignStatuses(squad: Player[]): void {
  [...squad].sort((a, b) => b.rating - a.rating).forEach((p, i) => (p.squadStatus = statusForRank(i, p.age)));
}
