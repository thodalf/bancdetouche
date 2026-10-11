import { GameState, POSITION_LABELS } from '../models';
import { clamp, createPlayer, SQUAD_TEMPLATE } from './player-factory';
import { Rng } from './rng';
import { MAX_SQUAD } from './transfers';
import { expectedWage, roundMoney } from './valuation';
import { potentialEstimate, starsText } from './scouting';
import { addNews, clubById, fullName, IdGen, playerById, squadOf, youthOf } from './world';
import { fx } from './characters';

/** Semaine (index) de la promotion annuelle des jeunes du centre de formation. */
export const YOUTH_INTAKE_WEEK = 16;
/** Âge à partir duquel un jeune doit intégrer l'équipe première. */
export const YOUTH_MAX_AGE = 19;

export const intakeSize = (academyLevel: number) => ({ min: 2 + Math.floor(academyLevel / 2), max: 3 + Math.floor(academyLevel / 2) });

/** Génère les « regens » du centre de formation du club de l'utilisateur. */
export function youthIntake(s: GameState, rng: Rng, ids: IdGen): void {
  const club = clubById(s, s.userClubId);
  const level = club.facilities.academy;
  const { min, max } = intakeSize(level);
  const count = rng.int(min, max) + Math.round(fx(s, 'intakeSize'));
  const potentialBonus = Math.round(fx(s, 'youthPotential'));
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const p = createPlayer(rng, { id: ids('p'), position: rng.pick(SQUAD_TEMPLATE), meanRating: 40 + level * 3, clubId: club.id, age: rng.int(15, 17) });
    p.rating = clamp(p.rating, 35, 62);
    p.potential = clamp(p.rating + rng.int(12, 28) + level * 2 + potentialBonus, p.rating, 95);
    p.youth = true;
    p.homegrownClubId = club.id;
    p.squadStatus = 'prospect';
    p.wage = roundMoney(300 + level * 150);
    p.contractYears = 3;
    p.releaseClause = null;
    s.players.push(p);
    const est = potentialEstimate(s, p);
    names.push(`${fullName(p)} (${POSITION_LABELS[p.position]}, ${p.age} ans, potentiel ${est ? starsText(est.stars) : '?'})`);
  }
  addNews(s, 'youth', `Promotion ${s.season} du centre de formation`, `${count} jeunes rejoignent le centre : ${names.join(', ')}.`, ids);
}

/** Progression mensuelle des jeunes du centre. */
export function youthDevelopment(s: GameState, rng: Rng): void {
  const club = clubById(s, s.userClubId);
  const growth = 1 + fx(s, 'youthGrowth');
  for (const p of youthOf(s, club.id)) {
    if (p.rating >= p.potential) continue;
    if (rng.chance((0.35 + club.facilities.academy * 0.08) * growth)) p.rating = Math.min(p.potential, p.rating + rng.int(1, 2));
  }
}

export function promoteYouth(s: GameState, playerId: string, ids: IdGen): { ok: boolean; message: string } {
  const p = playerById(s, playerId);
  if (!p || !p.youth || p.clubId !== s.userClubId) return { ok: false, message: 'Joueur introuvable.' };
  if (squadOf(s, s.userClubId).length >= MAX_SQUAD) return { ok: false, message: `Effectif professionnel complet (${MAX_SQUAD} joueurs).` };
  p.youth = false;
  p.squadStatus = 'prospect';
  p.wage = Math.max(p.wage, roundMoney(expectedWage(p) * 0.6));
  p.contractYears = Math.max(p.contractYears, 3);
  addNews(s, 'youth', `${fullName(p)} intègre l'équipe première`, `Formé au club, ${fullName(p)} (${p.age} ans) signe son premier contrat professionnel.`, ids);
  return { ok: true, message: `${fullName(p)} est promu en équipe première.` };
}

export function releaseYouth(s: GameState, playerId: string): { ok: boolean; message: string } {
  const p = playerById(s, playerId);
  if (!p || !p.youth || p.clubId !== s.userClubId) return { ok: false, message: 'Joueur introuvable.' };
  p.youth = false;
  p.clubId = null;
  p.contractYears = 0;
  return { ok: true, message: `${fullName(p)} quitte le centre de formation.` };
}

/** Fin de saison : les jeunes trop âgés passent professionnels (ou partent si l'effectif est plein). */
export function seasonEndYouth(s: GameState, ids: IdGen): void {
  for (const p of youthOf(s, s.userClubId)) {
    if (p.age < YOUTH_MAX_AGE) continue;
    const res = promoteYouth(s, p.id, ids);
    if (!res.ok) releaseYouth(s, p.id);
  }
}
