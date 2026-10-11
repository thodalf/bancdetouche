import { CUP_NAME, LEAGUE_NAME } from '../data/clubs.data';
import { BoardObjective, BoardState, CUP_ROUND_LABELS, Fixture, GameState, ObjectiveImportance, ObjectiveStatus } from '../models';
import { wageBill } from './finance';
import { clamp } from './player-factory';
import { fixtureWinner } from './schedule';
import { computeStandings } from './standings';
import { roundMoney } from './valuation';
import { addNews, clubById, IdGen, squadOf } from './world';
import { fx } from './characters';

export const SACK_THRESHOLD = 12;
const WEIGHT: Record<ObjectiveImportance, number> = { low: 1, medium: 2, high: 3 };

export const IMPORTANCE_LABELS: Record<ObjectiveImportance, string> = { low: 'Secondaire', medium: 'Important', high: 'Prioritaire' };
export const STATUS_LABELS: Record<ObjectiveStatus, string> = {
  achieved: 'Atteint',
  'on-track': 'En bonne voie',
  'at-risk': 'En danger',
  failed: 'Manqué',
};

/** Objectifs fixés par la direction pour la saison (ou le reste de la saison après une arrivée). */
export function createBoard(s: GameState, confidence = 60): BoardState {
  const club = clubById(s, s.userClubId);
  const rank = [...s.clubs].sort((a, b) => b.reputation - a.reputation).findIndex((c) => c.id === club.id) + 1;
  // Le club le plus modeste doit au minimum éviter la dernière place.
  const leagueTarget = Math.min(s.clubs.length - 1, rank === 1 ? 1 : rank + 1);
  const objectives: BoardObjective[] = [
    {
      kind: 'league',
      label: leagueTarget === 1 ? `Remporter la ${LEAGUE_NAME}` : `Finir dans le top ${leagueTarget} de la ${LEAGUE_NAME}`,
      target: leagueTarget,
      importance: 'high',
    },
  ];
  const cupTarget = rank <= 2 ? 3 : rank <= 6 ? 2 : rank <= 11 ? 1 : -1;
  if (cupTarget >= 0) {
    objectives.push({
      kind: 'cup',
      label: `${CUP_NAME} : atteindre ${cupTarget === 3 ? 'la finale' : cupTarget === 2 ? 'les demi-finales' : 'les quarts de finale'}`,
      target: cupTarget,
      importance: rank <= 6 ? 'medium' : 'low',
    });
  }
  const floor = roundMoney(Math.max(0, club.balance - Math.max(2_000_000, club.balance * 0.1)));
  const financeLabel = floor > 0 ? `Garder une trésorerie d'au moins ${(floor / 1e6).toFixed(1).replace('.', ',')} M€` : 'Ne pas finir la saison dans le rouge';
  objectives.push({ kind: 'finance', label: financeLabel, target: floor, importance: 'medium' });
  objectives.push({ kind: 'wages', label: 'Respecter la masse salariale autorisée', target: club.wageBudget, importance: 'medium' });
  if (club.facilities.academy >= 3 || rank > 8) {
    objectives.push({ kind: 'youth', label: 'Donner du temps de jeu à 2 joueurs de 21 ans ou moins (5 matchs)', target: 2, importance: 'low' });
  }
  return { confidence, objectives, startBalance: club.balance, reviews: [] };
}

/** Plus haut tour de coupe atteint par le club de l'utilisateur, et s'il est éliminé. */
function cupProgress(s: GameState): { reached: number; out: boolean } {
  const mine = s.fixtures.filter((f) => f.competition === 'cup' && (f.homeId === s.userClubId || f.awayId === s.userClubId));
  if (!mine.length) return { reached: -1, out: true };
  const last = mine.sort((a, b) => a.week - b.week)[mine.length - 1];
  const reached = s.weeks[last.week].round;
  const out = last.played && fixtureWinner(last) !== s.userClubId;
  return { reached: out ? reached : reached + (last.played ? 1 : 0), out };
}

export function objectiveStatus(s: GameState, o: BoardObjective): { status: ObjectiveStatus; detail: string } {
  const over = s.currentWeek >= s.weeks.length;
  const club = clubById(s, s.userClubId);
  switch (o.kind) {
    case 'league': {
      const table = computeStandings(s.clubs.map((c) => c.id), s.fixtures);
      const pos = table.findIndex((r) => r.clubId === s.userClubId) + 1;
      const detail = `Actuellement ${pos}e`;
      if (over) return { status: pos <= o.target ? 'achieved' : 'failed', detail: `Classement final : ${pos}e` };
      return { status: pos <= o.target ? 'on-track' : 'at-risk', detail };
    }
    case 'cup': {
      const { reached, out } = cupProgress(s);
      const label = reached >= 0 && reached < CUP_ROUND_LABELS.length ? CUP_ROUND_LABELS[reached] : reached >= CUP_ROUND_LABELS.length ? 'Vainqueur' : '—';
      if (reached >= o.target) return { status: 'achieved', detail: `Atteint : ${label}` };
      if (out) return { status: 'failed', detail: `Éliminé (${label.toLowerCase()})` };
      return { status: 'on-track', detail: `Prochain tour : ${label}` };
    }
    case 'finance': {
      const ok = club.balance >= o.target;
      const detail = `Trésorerie : ${(club.balance / 1e6).toFixed(1).replace('.', ',')} M€`;
      if (over) return { status: ok ? 'achieved' : 'failed', detail };
      return { status: ok ? 'on-track' : 'at-risk', detail };
    }
    case 'wages': {
      const bill = wageBill(squadOf(s, s.userClubId));
      const ok = bill <= club.wageBudget;
      const detail = `${Math.round((bill / club.wageBudget) * 100)} % de l'enveloppe utilisée`;
      if (over) return { status: ok ? 'achieved' : 'failed', detail };
      return { status: ok ? 'on-track' : 'at-risk', detail };
    }
    case 'youth': {
      const n = squadOf(s, s.userClubId).filter((p) => p.age <= 21 && p.stats.appearances >= 5).length;
      if (n >= o.target) return { status: 'achieved', detail: `${n} jeune(s) lancé(s)` };
      return { status: over ? 'failed' : 'on-track', detail: `${n}/${o.target} pour l'instant` };
    }
  }
}

/** Réaction de la direction après chaque match de l'utilisateur. */
export function boardAfterMatch(s: GameState, f: Fixture): void {
  const user = clubById(s, s.userClubId);
  const opp = clubById(s, f.homeId === s.userClubId ? f.awayId : f.homeId);
  const winner = fixtureWinner(f);
  const favourite = user.reputation >= opp.reputation + 5;
  const underdog = opp.reputation >= user.reputation + 5;
  let delta = 0;
  if (winner === s.userClubId) delta = (underdog ? 4 : 2) + fx(s, 'boardConfidence');
  else if (winner === null) delta = favourite ? -1 : underdog ? 1 : 0;
  else delta = favourite ? -4 : underdog ? -1 : -2;
  s.board.confidence = clamp(s.board.confidence + delta, 0, 100);
}

/** Point d'étape toutes les 6 semaines. */
export function boardReview(s: GameState, ids: IdGen): void {
  let delta = 0;
  const lines: string[] = [];
  for (const o of s.board.objectives) {
    const { status } = objectiveStatus(s, o);
    const w = WEIGHT[o.importance];
    if (status === 'on-track' || status === 'achieved') delta += w * 0.7;
    if (status === 'at-risk') {
      delta -= w * 1.3;
      lines.push(o.label.toLowerCase());
    }
  }
  s.board.confidence = clamp(Math.round(s.board.confidence + delta), 0, 100);
  const text = lines.length ? `Points d'inquiétude : ${lines.join(' ; ')}.` : 'La direction est satisfaite du travail accompli.';
  s.board.reviews.push({ season: s.season, week: s.currentWeek, confidence: s.board.confidence, text });
  addNews(s, 'board', `Point d'étape de la direction (confiance ${s.board.confidence}/100)`, text, ids);
}

/** Bilan de fin de saison : chaque objectif atteint ou manqué pèse selon son importance. */
export function boardSeasonReview(s: GameState, ids: IdGen): void {
  let delta = 0;
  const done: string[] = [];
  const missed: string[] = [];
  for (const o of s.board.objectives) {
    const { status } = objectiveStatus(s, o);
    const w = WEIGHT[o.importance];
    if (status === 'achieved') {
      delta += w * 4;
      done.push(o.label);
    } else if (status === 'failed') {
      delta -= w * 5;
      missed.push(o.label);
    }
  }
  s.board.confidence = clamp(Math.round(s.board.confidence + delta), 0, 100);
  const text =
    (done.length ? `Objectifs atteints : ${done.join(' ; ')}. ` : '') + (missed.length ? `Objectifs manqués : ${missed.join(' ; ')}.` : 'Aucun objectif manqué.');
  s.board.reviews.push({ season: s.season, week: s.currentWeek, confidence: s.board.confidence, text });
  addNews(s, 'board', `Bilan de la saison : confiance ${s.board.confidence}/100`, text, ids);
}

export const shouldSack = (s: GameState) => s.board.confidence < SACK_THRESHOLD && (s.currentWeek >= 6 || s.currentWeek >= s.weeks.length);
