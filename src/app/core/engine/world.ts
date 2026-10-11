import { LEVEL_MEAN_RATING } from '../data/clubs.data';
import { FinanceCategory, GameState, NewsKind, Player, POSITION_GROUP } from '../models';
import { createPlayer, SQUAD_TEMPLATE } from './player-factory';
import { Rng } from './rng';

/** Générateur d'identifiants lié à un état de jeu (compteur sauvegardé). */
export type IdGen = (prefix?: string) => string;

export function idGenFor(state: { nextId: number }): IdGen {
  return (prefix = 'x') => `${prefix}${(state.nextId++).toString(36)}`;
}

/** Horodatage absolu (saison + semaine) pour les échéances : offres, blocages de négociation… */
export const nowStamp = (s: Pick<GameState, 'season' | 'currentWeek'>) => s.season * 100 + s.currentWeek;

// ------------------------------------------------------------------ accès

export const clubById = (s: GameState, id: string) => s.clubs.find((c) => c.id === id)!;
/** Effectif professionnel (hors centre de formation). */
export const squadOf = (s: GameState, clubId: string) => s.players.filter((p) => p.clubId === clubId && !p.youth);
/** Jeunes du centre de formation. */
export const youthOf = (s: GameState, clubId: string) => s.players.filter((p) => p.clubId === clubId && p.youth);
export const playerById = (s: GameState, id: string) => s.players.find((p) => p.id === id);
export const fullName = (p: Player) => `${p.firstName} ${p.lastName}`;

export function addNews(s: GameState, kind: NewsKind, title: string, body: string, ids: IdGen): void {
  s.news.unshift({ id: ids('n'), week: s.currentWeek, season: s.season, kind, title, body, read: false });
  if (s.news.length > 150) s.news.length = 150;
}

/** Mouvement financier : met à jour la trésorerie et, pour le club de l'entraîneur, le grand livre. */
export function addMoney(s: GameState, clubId: string, category: FinanceCategory, amount: number, label: string): void {
  const club = clubById(s, clubId);
  club.balance += amount;
  if (clubId === s.userClubId && amount !== 0) {
    s.ledger.push({ season: s.season, week: Math.min(s.currentWeek, s.weeks.length - 1), clubId, category, amount, label });
    if (s.ledger.length > 1500) s.ledger.splice(0, s.ledger.length - 1500);
  }
}

// ------------------------------------------------------------------ génération

export function generateSquad(rng: Rng, ids: IdGen, clubId: string, level: number): Player[] {
  const mean = LEVEL_MEAN_RATING[level];
  return SQUAD_TEMPLATE.map((position, i) => {
    // Les premiers de chaque poste sont un peu meilleurs : un onze type se dégage.
    const starterBoost = i % 2 === 0 ? 2 : -2;
    return createPlayer(rng, { id: ids('p'), position, meanRating: mean + starterBoost, clubId });
  });
}

export function generateFreeAgents(rng: Rng, ids: IdGen, count: number): Player[] {
  return Array.from({ length: count }, () => {
    const position = rng.pick(SQUAD_TEMPLATE);
    const p = createPlayer(rng, { id: ids('p'), position, meanRating: rng.int(56, 70), clubId: null });
    p.contractYears = 0;
    return p;
  });
}

export function isKeyPlayer(s: GameState, p: Player): boolean {
  if (!p.clubId) return false;
  const club = clubById(s, p.clubId);
  return club.tactic.lineup.includes(p.id);
}

export function countByGroup(squad: Player[], group: 'GK' | 'DEF' | 'MID' | 'ATT'): number {
  return squad.filter((p) => POSITION_GROUP[p.position] === group).length;
}
