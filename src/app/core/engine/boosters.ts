import { BOOSTER_LABELS, BoosterTier, CardRarity, GameState, MISSION_FOCUS_LABELS, MissionFocus, Player, Position } from '../models';
import { fx } from './characters';
import { wageBill } from './finance';
import { clamp, createPlayer, SQUAD_TEMPLATE, statusForRank } from './player-factory';
import { Rng } from './rng';
import { MAX_SQUAD } from './transfers';
import { expectedWage, roundMoney } from './valuation';
import { addMoney, addNews, clubById, fullName, IdGen, squadOf } from './world';

export interface BoosterSpec {
  tier: BoosterTier;
  /** Note moyenne et dispersion des joueurs tirés. */
  mean: number;
  spread: number;
  cards: number;
}

export const BOOSTERS: BoosterSpec[] = [
  { tier: 'bronze', mean: 61, spread: 5, cards: 3 },
  { tier: 'silver', mean: 67, spread: 5, cards: 3 },
  { tier: 'gold', mean: 73, spread: 5, cards: 3 },
  { tier: 'elite', mean: 79, spread: 6, cards: 3 },
];

export const boosterSpec = (tier: BoosterTier) => BOOSTERS.find((b) => b.tier === tier)!;

/** Expérience nécessaire pour passer du niveau `level` au suivant. */
export const xpToNext = (level: number) => 150 * level;

export function rarityOf(rating: number): CardRarity {
  if (rating >= 80) return 'legendary';
  if (rating >= 73) return 'epic';
  if (rating >= 65) return 'rare';
  return 'common';
}

/** Gain d'expérience ; chaque niveau franchi rapporte un point d'avantage (mode de vie). */
export function addXp(s: GameState, amount: number, ids: IdGen): void {
  if (amount <= 0 || s.manager.unemployed) return;
  const m = s.manager;
  m.xp += amount;
  while (m.xp >= xpToNext(m.level)) {
    m.xp -= xpToNext(m.level);
    m.level++;
    m.perkPoints++;
    addNews(s, 'booster', `Niveau ${m.level} atteint !`, 'Vous gagnez un point d’avantage à dépenser dans votre mode de vie (page Staff).', ids);
  }
}

// ------------------------------------------------------------------ missions de recrutement

export const MISSION_DURATIONS = [2, 4, 8];

export function missionCost(skill: number, weeks: number): number {
  return roundMoney(weeks * (35_000 + skill * 6_000));
}

/** Qualité attendue d'une mission : compétence, durée, cellule de recrutement, traits et avantages. */
export function missionScore(s: GameState, skill: number, weeks: number, extra = 0): number {
  const facility = clubById(s, s.userClubId).facilities.scouting;
  const durationBonus = weeks >= 8 ? 8 : weeks >= 4 ? 4 : 0;
  return skill + facility * 2 + durationBonus + extra;
}

export function tierForScore(score: number): BoosterTier {
  if (score >= 34) return 'elite';
  if (score >= 27) return 'gold';
  if (score >= 20) return 'silver';
  return 'bronze';
}

export function startMission(s: GameState, staffId: string, focus: MissionFocus, weeks: number, ids: IdGen): { ok: boolean; message: string } {
  const scout = s.staff.find((m) => m.id === staffId && m.role === 'scout');
  if (!scout) return { ok: false, message: 'Recruteur introuvable.' };
  if (scout.missionId) return { ok: false, message: `${scout.firstName} ${scout.lastName} est déjà en mission.` };
  const cost = missionCost(scout.skill, weeks);
  if (clubById(s, s.userClubId).balance < cost) return { ok: false, message: 'Trésorerie insuffisante pour financer la mission.' };
  // Un globe-trotteur rentre plus vite.
  const duration = Math.max(1, weeks - (scout.traits.includes('globetrotter') ? 1 : 0));
  const mission = { id: ids('mi'), staffId, focus, weeks: duration, weeksLeft: duration, cost };
  addMoney(s, s.userClubId, 'booster', -cost, `Mission de recrutement : ${MISSION_FOCUS_LABELS[focus].toLowerCase()}`);
  s.missions.push(mission);
  scout.missionId = mission.id;
  return { ok: true, message: `${scout.firstName} ${scout.lastName} part pour ${duration} semaine(s).` };
}

/** Avancement hebdomadaire : au retour, le recruteur rapporte un booster. */
export function weeklyMissions(s: GameState, rng: Rng, ids: IdGen): void {
  const quality = fx(s, 'boosterQuality');
  for (const mission of [...s.missions]) {
    mission.weeksLeft--;
    if (mission.weeksLeft > 0) continue;
    const scout = s.staff.find((m) => m.id === mission.staffId);
    s.missions = s.missions.filter((m) => m.id !== mission.id);
    if (!scout) continue;
    scout.missionId = null;
    const tier = tierForScore(missionScore(s, scout.skill, mission.weeks, quality + rng.int(-3, 3)));
    s.boosters.items.push({ id: ids('bi'), tier, focus: mission.focus, scoutName: `${scout.firstName} ${scout.lastName}`, scoutSkill: scout.skill });
    addNews(s, 'booster', `Retour de mission : booster ${BOOSTER_LABELS[tier]}`, `${scout.firstName} ${scout.lastName} rapporte un dossier « ${MISSION_FOCUS_LABELS[mission.focus].toLowerCase()} ». Ouvrez-le depuis la page Boosters.`, ids);
  }
}

// ------------------------------------------------------------------ cartes

const GROUP_POSITIONS: Record<'GK' | 'DEF' | 'MID' | 'ATT', Position[]> = {
  GK: ['GK'],
  DEF: ['CB', 'CB', 'LB', 'RB'],
  MID: ['DM', 'CM', 'CM', 'LM', 'RM', 'AM'],
  ATT: ['LW', 'RW', 'ST', 'ST'],
};

/** Génère les cartes d'un booster selon la consigne de la mission : des joueurs inédits, sans club. */
function generateCards(spec: BoosterSpec, focus: MissionFocus, rng: Rng, ids: IdGen): Player[] {
  return Array.from({ length: spec.cards }, () => {
    const young = focus === 'youth' ? true : focus === 'experienced' ? false : rng.chance(0.3);
    const position = focus in GROUP_POSITIONS ? rng.pick(GROUP_POSITIONS[focus as 'GK']) : rng.pick(SQUAD_TEMPLATE);
    const p = createPlayer(rng, { id: ids('p'), position, meanRating: spec.mean, clubId: null, age: young ? rng.int(17, 21) : focus === 'experienced' ? rng.int(27, 32) : rng.int(22, 31) });
    const jackpot = rng.chance(0.06) ? rng.int(5, 9) : 0;
    const bonus = focus === 'experienced' ? 2 : focus === 'bargain' ? -2 : young ? -3 : 0;
    p.rating = Math.round(clamp(rng.normal(spec.mean, spec.spread) + jackpot + bonus, 45, 92));
    p.potential = clamp(p.rating + (young ? rng.int(8, 20) + (focus === 'youth' ? 3 : 0) : rng.int(0, 3)), p.rating, 95);
    p.wage = roundMoney(expectedWage(p) * (focus === 'bargain' ? 0.7 : 1));
    p.contractYears = 0;
    p.morale = 75;
    return p;
  });
}

export function openBooster(s: GameState, itemId: string, rng: Rng, ids: IdGen): { ok: boolean; message: string } {
  if (s.pendingPack) return { ok: false, message: "Choisissez d'abord un joueur dans le booster déjà ouvert." };
  const item = s.boosters.items.find((b) => b.id === itemId);
  if (!item) return { ok: false, message: 'Booster introuvable.' };
  s.boosters.items = s.boosters.items.filter((b) => b.id !== itemId);
  const cards = generateCards(boosterSpec(item.tier), item.focus, rng, ids);
  // Le rapport du recruteur rend l'estimation du potentiel plus ou moins fiable.
  const knowledge = clamp(45 + item.scoutSkill * 2.5 + fx(s, 'scoutAccuracy'), 40, 95);
  cards.forEach((c) => (s.scouting.knowledge[c.id] = knowledge));
  s.pendingPack = { id: ids('b'), tier: item.tier, scoutName: item.scoutName, cards };
  s.boosters.opened++;
  return { ok: true, message: `Booster ${BOOSTER_LABELS[item.tier]} ouvert.` };
}

/** Le joueur choisi signe 3 ans au salaire attendu ; les deux autres cartes sont perdues. */
export function claimCard(s: GameState, cardId: string, ids: IdGen): { ok: boolean; message: string } {
  const pack = s.pendingPack;
  const card = pack?.cards.find((c) => c.id === cardId);
  if (!pack || !card) return { ok: false, message: 'Carte introuvable.' };
  const club = clubById(s, s.userClubId);
  const squad = squadOf(s, club.id);
  if (squad.length >= MAX_SQUAD) return { ok: false, message: `Effectif complet (${MAX_SQUAD} joueurs). Libérez une place ou renoncez au booster.` };
  if (wageBill(squad) + card.wage > club.wageBudget) {
    return { ok: false, message: `Masse salariale insuffisante : ${fullName(card)} demande ${Math.round(card.wage / 1000)} k€ par semaine.` };
  }
  const rank = squad.filter((p) => p.rating > card.rating).length;
  card.clubId = club.id;
  card.contractYears = 3;
  card.squadStatus = statusForRank(rank, card.age);
  s.players.push(card);
  releaseCards(s, pack.cards.filter((c) => c.id !== card.id), pack.scoutName);
  s.pendingPack = null;
  addNews(s, 'booster', `${fullName(card)} rejoint l'équipe`, `Repéré par ${pack.scoutName} (booster ${BOOSTER_LABELS[pack.tier]}), ${fullName(card)} signe pour 3 ans.`, ids);
  return { ok: true, message: `${fullName(card)} signe au club !` };
}

/**
 * Les joueurs non retenus ne disparaissent pas : ils deviennent libres et restent
 * visibles (avec le rapport du recruteur) sur le marché des transferts.
 */
function releaseCards(s: GameState, cards: Player[], scoutName: string): void {
  for (const c of cards) {
    if (s.players.some((p) => p.id === c.id)) continue;
    s.players.push({ ...c, clubId: null, contractYears: 0, scoutedBy: scoutName });
  }
}

export function discardPack(s: GameState): void {
  if (s.pendingPack) releaseCards(s, s.pendingPack.cards, s.pendingPack.scoutName);
  s.pendingPack = null;
}

/** Barème d'expérience. */
export const XP = {
  win: 40,
  draw: 15,
  loss: 5,
  goal: 4,
  cleanSheet: 10,
  cupRound: 30,
  league: 400,
  cup: 250,
  objective: 80,
};
