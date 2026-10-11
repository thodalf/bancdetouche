import { FormationId, FormationSlot, FORMATIONS, isNonEu, Player, Position, POSITION_GROUP, Tactic, tacticSlots } from '../models';

/** Règle de composition : nombre maximal d'extracommunautaires dans le onze de départ. */
export const MAX_NON_EU_XI = 3;

/** Affinités entre postes voisins (symétrie non garantie volontairement). */
const NEIGHBOURS: Partial<Record<Position, Partial<Record<Position, number>>>> = {
  CB: { DM: 0.85, LB: 0.85, RB: 0.85 },
  LB: { LM: 0.9, RB: 0.85, CB: 0.85, LW: 0.75 },
  RB: { RM: 0.9, LB: 0.85, CB: 0.85, RW: 0.75 },
  DM: { CM: 0.92, CB: 0.85 },
  CM: { DM: 0.92, AM: 0.9, LM: 0.82, RM: 0.82 },
  LM: { LW: 0.92, LB: 0.85, RM: 0.85, CM: 0.82 },
  RM: { RW: 0.92, RB: 0.85, LM: 0.85, CM: 0.82 },
  AM: { CM: 0.9, ST: 0.85, LW: 0.85, RW: 0.85 },
  LW: { LM: 0.92, RW: 0.88, AM: 0.85, ST: 0.82 },
  RW: { RM: 0.92, LW: 0.88, AM: 0.85, ST: 0.82 },
  ST: { AM: 0.85, LW: 0.8, RW: 0.8 },
};

/** Coefficient d'adaptation d'un joueur à un poste (1 = poste naturel). */
export function positionFit(natural: Position, slot: Position): number {
  if (natural === slot) return 1;
  if (natural === 'GK' || slot === 'GK') return 0.25;
  const n = NEIGHBOURS[natural]?.[slot];
  if (n) return n;
  return POSITION_GROUP[natural] === POSITION_GROUP[slot] ? 0.8 : 0.6;
}

/** Multiplicateur lié à la condition physique, à la forme et au moral du joueur. */
export function conditionFactor(p: Pick<Player, 'fatigue' | 'form' | 'morale'>): number {
  return (1 - (p.fatigue / 100) * 0.25) * (0.9 + p.form * 0.02) * (0.94 + (p.morale ?? 50) * 0.0012);
}

export function effectiveRating(p: Player, slot: Position): number {
  return p.rating * positionFit(p.position, slot) * conditionFactor(p);
}

export const isAvailable = (p: Player) => p.injuryWeeks <= 0;

/** Sélection automatique du meilleur onze pour une formation (affectation gloutonne). */
export function autoPickLineup(players: Player[], formation: FormationId | FormationSlot[]): (string | null)[] {
  const slots = typeof formation === 'string' ? FORMATIONS[formation].slots : formation;
  const pool = players.filter(isAvailable);
  const pairs: { slot: number; player: Player; score: number }[] = [];
  slots.forEach((s, i) => pool.forEach((p) => pairs.push({ slot: i, player: p, score: effectiveRating(p, s.role) })));
  pairs.sort((a, b) => b.score - a.score);
  const lineup: (string | null)[] = slots.map(() => null);
  const used = new Set<string>();
  let nonEu = 0;
  for (const pair of pairs) {
    if (lineup[pair.slot] !== null || used.has(pair.player.id)) continue;
    // Règle des extracommunautaires respectée dès la sélection automatique.
    if (isNonEu(pair.player) && nonEu >= MAX_NON_EU_XI) continue;
    lineup[pair.slot] = pair.player.id;
    used.add(pair.player.id);
    if (isNonEu(pair.player)) nonEu++;
  }
  return lineup;
}

/** Complète un onze incomplet ou contenant des blessés/joueurs partis. */
export function repairLineup(tactic: Tactic, squad: Player[]): (string | null)[] {
  const byId = new Map(squad.map((p) => [p.id, p]));
  const slots = tacticSlots(tactic);
  const lineup = slots.map((_, i) => {
    const id = tactic.lineup[i] ?? null;
    const p = id ? byId.get(id) : undefined;
    return p && isAvailable(p) ? id : null;
  });
  if (lineup.every((id) => id !== null)) return lineup;
  const used = new Set(lineup.filter((x): x is string => !!x));
  let nonEu = squad.filter((p) => used.has(p.id) && isNonEu(p)).length;
  const pool = squad.filter((p) => isAvailable(p) && !used.has(p.id));
  slots.forEach((s, i) => {
    if (lineup[i]) return;
    const best = pool
      .filter((p) => !used.has(p.id) && (!isNonEu(p) || nonEu < MAX_NON_EU_XI))
      .sort((a, b) => effectiveRating(b, s.role) - effectiveRating(a, s.role))[0];
    if (best) {
      lineup[i] = best.id;
      used.add(best.id);
      if (isNonEu(best)) nonEu++;
    }
  });
  return lineup;
}

export interface TeamStrength {
  goalkeeping: number;
  defense: number;
  midfield: number;
  attack: number;
  overall: number;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 35);

export function teamStrength(tactic: Tactic, squad: Player[]): TeamStrength {
  const byId = new Map(squad.map((p) => [p.id, p]));
  const slots = tacticSlots(tactic);
  const groups: Record<string, number[]> = { GK: [], DEF: [], MID: [], ATT: [] };
  slots.forEach((s, i) => {
    const id = tactic.lineup[i];
    const p = id ? byId.get(id) : undefined;
    groups[POSITION_GROUP[s.role]].push(p ? effectiveRating(p, s.role) : 30);
  });
  const gk = avg(groups['GK']);
  const def = avg(groups['DEF']);
  const mid = avg(groups['MID']);
  const att = avg(groups['ATT']);
  // Plus de défenseurs = défense plus solide, plus d'attaquants = attaque plus tranchante.
  const defCount = groups['DEF'].length;
  const attCount = groups['ATT'].length;
  const defense = (def * 0.72 + mid * 0.28) * (1 + (defCount - 4) * 0.025);
  const attack = (att * 0.68 + mid * 0.32) * (1 + (attCount - 2) * 0.02);
  const midfield = mid * (1 + (groups['MID'].length - 4) * 0.02);
  return {
    goalkeeping: gk,
    defense,
    midfield,
    attack,
    overall: gk * 0.1 + defense * 0.3 + midfield * 0.3 + attack * 0.3,
  };
}

/** Note « globale » d'une équipe affichée dans l'interface (moyenne du meilleur onze). */
export function squadRating(squad: Player[], formation: FormationId = '4-3-3'): number {
  const lineup = autoPickLineup(squad, formation);
  const byId = new Map(squad.map((p) => [p.id, p]));
  const ratings = lineup.map((id) => (id ? byId.get(id)!.rating : 40));
  return Math.round(avg(ratings));
}
