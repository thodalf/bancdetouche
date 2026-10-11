import { GameState, Player, POSITION_LABELS } from '../models';
import { Rng } from './rng';
import { addNews, clubById, fullName, IdGen, playerById } from './world';
import { fx } from './characters';

/** Connaissance initiale d'un joueur de la ligue (on voit ses matchs à la télévision). */
const LEAGUE_BASELINE = 25;

export interface RatingView {
  exact: boolean;
  min: number;
  max: number;
  /** Valeur centrale de l'estimation (utilisée pour trier et filtrer sans révéler la vraie note). */
  estimate: number;
  potential: { min: number; max: number } | null;
}

export function knowledgeOf(s: GameState, p: Player): number {
  if (p.clubId === s.userClubId) return 100;
  const k = s.scouting.knowledge[p.id];
  if (k !== undefined) return k;
  return p.clubId ? LEAGUE_BASELINE : 0;
}

/** Bruit déterministe propre à chaque joueur (stable entre deux affichages). */
function hash(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

/** Brouillard de guerre : intervalle de note d'autant plus large que le joueur est mal connu. */
export function ratingView(p: Player, knowledge: number): RatingView {
  if (knowledge >= 100) {
    return { exact: true, min: p.rating, max: p.rating, estimate: p.rating, potential: { min: p.potential, max: p.potential } };
  }
  const width = Math.round(((100 - knowledge) / 100) * 18) + 2;
  const offset = Math.round(hash(p.id) * width);
  const min = Math.max(30, p.rating - offset);
  const max = Math.min(99, min + width);
  let potential: RatingView['potential'] = null;
  if (knowledge >= 50) {
    const pw = Math.round(((100 - knowledge) / 100) * 20) + 3;
    const po = Math.round(hash(p.id + 'p') * pw);
    const pmin = Math.max(min, p.potential - po);
    potential = { min: pmin, max: Math.min(99, pmin + pw) };
  }
  return { exact: false, min, max, estimate: Math.round((min + max) / 2), potential };
}

export interface PotentialEstimate {
  /** De 0,5 à 5 étoiles, par demi-étoiles. */
  stars: number;
  min: number;
  max: number;
  /** Fiabilité du rapport en %. */
  confidence: number;
}

/** Conversion d'une note de potentiel en étoiles (50 → ½, 90+ → 5). */
export const potentialStars = (value: number) => Math.min(5, Math.max(0.5, Math.round(((value - 50) / 9) * 2) / 2 + 0.5));

/**
 * Potentiel tel que l'estiment les recruteurs. Personne n'a accès au chiffre réel :
 * même pour les joueurs du club, l'avis dépend de la qualité de la cellule de recrutement.
 */
export function potentialEstimate(s: GameState, p: Player): PotentialEstimate | null {
  const level = clubById(s, s.userClubId).facilities.scouting;
  const own = p.clubId === s.userClubId;
  // Le chef recruteur (et ses traits) rend l'avis plus fiable.
  const accuracy = fx(s, 'scoutAccuracy');
  const k = own ? Math.min(100, 45 + level * 8 + accuracy) : Math.min(knowledgeOf(s, p), 40 + level * 9 + accuracy);
  if (k < 30) return null;
  const bias = (hash(p.id + 'pe') - 0.5) * 2 * ((100 - k) / 100) * 12;
  const estimate = p.potential + bias;
  const spread = ((100 - k) / 100) * 8 + 1;
  return {
    stars: potentialStars(estimate),
    min: Math.round(Math.max(p.rating, estimate - spread)),
    max: Math.round(Math.min(99, estimate + spread)),
    confidence: Math.round(k),
  };
}

export const starsText = (stars: number) => '★'.repeat(Math.floor(stars)) + (stars % 1 ? '½' : '');

export const maxAssignments = (s: GameState) => 2 + clubById(s, s.userClubId).facilities.scouting;

export function assignScout(s: GameState, playerId: string): { ok: boolean; message: string } {
  const p = playerById(s, playerId);
  if (!p) return { ok: false, message: 'Joueur introuvable.' };
  if (knowledgeOf(s, p) >= 100) return { ok: false, message: `${fullName(p)} est déjà parfaitement connu.` };
  if (s.scouting.assignments.includes(playerId)) {
    s.scouting.assignments = s.scouting.assignments.filter((id) => id !== playerId);
    return { ok: true, message: `Observation de ${fullName(p)} arrêtée.` };
  }
  if (s.scouting.assignments.length >= maxAssignments(s)) {
    return { ok: false, message: `Vos recruteurs suivent déjà ${maxAssignments(s)} joueurs. Améliorez la cellule de recrutement ou arrêtez une observation.` };
  }
  s.scouting.assignments.push(playerId);
  if (s.scouting.knowledge[playerId] === undefined) s.scouting.knowledge[playerId] = knowledgeOf(s, p);
  return { ok: true, message: `Un recruteur part observer ${fullName(p)}.` };
}

/** Progression hebdomadaire des observations. */
export function weeklyScouting(s: GameState, rng: Rng, ids: IdGen): void {
  const level = clubById(s, s.userClubId).facilities.scouting;
  const speed = 1 + fx(s, 'scoutSpeed');
  for (const id of [...s.scouting.assignments]) {
    const p = playerById(s, id);
    if (!p || p.clubId === s.userClubId) {
      s.scouting.assignments = s.scouting.assignments.filter((x) => x !== id);
      continue;
    }
    const k = Math.min(100, (s.scouting.knowledge[id] ?? 0) + Math.round((18 + level * 7 + rng.int(0, 8)) * speed));
    s.scouting.knowledge[id] = k;
    if (k >= 100) {
      s.scouting.assignments = s.scouting.assignments.filter((x) => x !== id);
      const club = p.clubId ? clubById(s, p.clubId).name : 'libre';
      addNews(
        s,
        'scouting',
        `Rapport complet : ${fullName(p)}`,
        `${fullName(p)} (${POSITION_LABELS[p.position]}, ${p.age} ans, ${club}) : note ${p.rating}. Potentiel estimé : ${reportPotential(s, p)}.`,
        ids,
      );
    }
  }
}

/** Affronter une équipe permet d'en apprendre un peu sur ses joueurs. */
export function learnFromMatch(s: GameState, playerIds: string[]): void {
  for (const id of playerIds) {
    const p = playerById(s, id);
    if (!p || p.clubId === s.userClubId) continue;
    s.scouting.knowledge[id] = Math.min(95, Math.max(s.scouting.knowledge[id] ?? LEAGUE_BASELINE, LEAGUE_BASELINE) + 8);
  }
}

function reportPotential(s: GameState, p: Player): string {
  const e = potentialEstimate(s, p);
  return e ? `${starsText(e.stars)} (${e.min}-${e.max})` : 'incertain';
}
