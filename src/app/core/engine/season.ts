import { CUP_NAME, LEAGUE_NAME } from '../data/clubs.data';
import { CUP_ROUND_LABELS, Fixture, GameState, Player, tacticSlots } from '../models';
import { seasonEndYouth, YOUTH_INTAKE_WEEK, youthDevelopment, youthIntake } from './academy';
import { boardAfterMatch, boardReview, boardSeasonReview, objectiveStatus, shouldSack } from './board';
import { addXp, weeklyMissions, XP } from './boosters';
import { expireJobOffers, midSeasonInterest, sackManager, seasonEndCareer } from './career';
import { progressConstruction, facilitiesUpkeep } from './facilities';
import { attendance, CUP_PRIZES, gateReceipts, leaguePrize, runningCosts, tvRights, wageBill, weeklySponsor } from './finance';
import { injuryRiskFor, monthlyGrowth, weeklyRecovery } from './fitness';
import { autoPickLineup, repairLineup } from './lineup';
import { MatchResult, MatchSimulation, SideInput } from './match-engine';
import { updateMoraleAfterMatch } from './morale';
import { assignStatuses, clamp, createPlayer, SQUAD_TEMPLATE } from './player-factory';
import { Rng } from './rng';
import { drawCupRound, fixtureWinner } from './schedule';
import { learnFromMatch, weeklyScouting } from './scouting';
import { computeStandings } from './standings';
import { formatM, weeklyMarket } from './transfers';
import { expectedWage } from './valuation';
import { addMoney, addNews, clubById, fullName, generateFreeAgents, IdGen, squadOf, youthOf } from './world';
import { startSeason } from './new-game';
import { refreshStaffMarket, seasonStaff, staffAfterMatch, totalEffects, weeklyStaff, fx } from './characters';
import { maybeTriggerEvent, tickModifiers } from './events';
import { applyTrainingWeek, weekMatchEffect } from './week';

export const isSeasonOver = (s: GameState) => s.currentWeek >= s.weeks.length;

export const fixturesOfWeek = (s: GameState, week: number) => s.fixtures.filter((f) => f.week === week);

export function userFixtureOfWeek(s: GameState, week = s.currentWeek): Fixture | undefined {
  return fixturesOfWeek(s, week).find((f) => f.homeId === s.userClubId || f.awayId === s.userClubId);
}

/** Données d'une équipe pour le moteur de match. Les clubs IA choisissent leur meilleur onze du moment. */
export function sideInput(s: GameState, clubId: string): SideInput {
  const club = clubById(s, clubId);
  const squad = squadOf(s, clubId);
  const userControlled = clubId === s.userClubId && !s.manager.unemployed;
  const lineup = userControlled ? repairLineup(club.tactic, squad) : autoPickLineup(squad, tacticSlots(club.tactic));
  const input: SideInput = { clubId, name: club.name, tactic: { ...club.tactic, lineup }, squad, morale: club.morale, injuryRisk: injuryRiskFor(club), aiControlled: !userControlled };
  if (userControlled) {
    // Staff, avantages et événements de l'entraîneur.
    const e = totalEffects(s);
    input.boost = e.matchStrength ?? 0;
    input.subEnergy = e.subEnergy ?? 0;
    input.injuryRisk = (input.injuryRisk ?? 1) * Math.max(0.3, 1 + (e.injuryRisk ?? 0));
    // Semaine de travail : entraînement, préparation de l'adversaire, conférence de presse.
    const week = weekMatchEffect(s);
    input.boost += week.strength;
    input.injuryRisk *= week.injury;
  }
  return input;
}

export function createMatch(s: GameState, f: Fixture, rng: Rng): MatchSimulation {
  return new MatchSimulation(sideInput(s, f.homeId), sideInput(s, f.awayId), rng, f.competition === 'league');
}

/** Graine dédiée au match de l'utilisateur, pour ne pas consommer l'aléa global pendant le direct. */
export const userMatchSeed = (s: GameState) => (s.rngSeed ^ ((s.currentWeek + 1) * 2654435761)) >>> 0;

function applyResult(s: GameState, f: Fixture, r: MatchResult, rng: Rng, ids: IdGen): void {
  f.played = true;
  f.homeGoals = r.homeGoals;
  f.awayGoals = r.awayGoals;
  f.penalties = r.penalties;
  f.stats = r.stats;
  f.ratings = r.ratings;
  const isUserMatch = f.homeId === s.userClubId || f.awayId === s.userClubId;
  // On ne garde le détail des événements que pour les matchs du joueur (taille de la sauvegarde).
  f.events = isUserMatch ? r.events : r.events.filter((e) => e.type === 'goal' || e.type === 'red');

  const byId = new Map(s.players.map((p) => [p.id, p]));
  const participants = new Set(r.participants);
  for (const id of r.participants) {
    const p = byId.get(id);
    if (!p) continue;
    const rating = r.ratings[id] ?? 6;
    p.fatigue = clamp(p.fatigue + rng.int(20, 30), 0, 100);
    p.form = Math.round(clamp(p.form * 0.6 + clamp(5 + (rating - 6.4) * 2.5, 0, 10) * 0.4, 0, 10) * 10) / 10;
    if (f.competition === 'league') {
      p.stats.appearances++;
      p.stats.ratingSum += rating;
    }
  }
  if (f.competition === 'league') {
    for (const g of r.goals) {
      const scorer = byId.get(g.playerId);
      if (scorer) scorer.stats.goals++;
      const assist = g.assistId ? byId.get(g.assistId) : undefined;
      if (assist) assist.stats.assists++;
    }
  }
  for (const [id, injury] of Object.entries(r.injuries)) {
    const p = byId.get(id);
    if (!p) continue;
    // Le médecin et les avantages raccourcissent les indisponibilités.
    const weeks = p.clubId === s.userClubId ? Math.max(1, Math.round(injury.weeks * Math.max(0.4, 1 + fx(s, 'injuryDuration')))) : injury.weeks;
    injury.weeks = weeks;
    p.injuryWeeks = Math.max(p.injuryWeeks, weeks);
    p.injury = injury.name;
    if (p.clubId === s.userClubId) addNews(s, 'injury', `Blessure : ${fullName(p)}`, `${injury.name} — ${fullName(p)} est indisponible pour environ ${injury.weeks} semaine(s).`, ids);
  }

  // Moral : collectif et individuel (résultat, performance, temps de jeu).
  const home = clubById(s, f.homeId);
  const away = clubById(s, f.awayId);
  const winner = fixtureWinner(f);
  const diff = Math.abs(r.homeGoals - r.awayGoals);
  for (const club of [home, away]) {
    const result: 'W' | 'D' | 'L' = winner === null ? 'D' : winner === club.id ? 'W' : 'L';
    const delta = result === 'D' ? 1 : result === 'W' ? 5 + diff : -4 - diff;
    club.morale = clamp(club.morale + delta, 15, 98);
    for (const p of squadOf(s, club.id)) {
      const before = p.morale;
      updateMoraleAfterMatch(p, participants.has(p.id), result, r.ratings[p.id]);
      if (club.id === s.userClubId && before >= 30 && p.morale < 30) {
        addNews(s, 'squad', `${fullName(p)} est mécontent`, `Son moral est au plus bas. Parlez temps de jeu ou statut en renégociant son contrat, ou envisagez une vente.`, ids);
      }
    }
  }

  if (isUserMatch) {
    const userHome = f.homeId === s.userClubId;
    const us = userHome ? r.homeGoals : r.awayGoals;
    const them = userHome ? r.awayGoals : r.homeGoals;
    const opp = userHome ? away : home;
    const verdict = winner === s.userClubId ? 'Victoire' : winner === null ? 'Match nul' : 'Défaite';
    const pens = r.penalties ? ` (t.a.b. ${userHome ? r.penalties.home : r.penalties.away}-${userHome ? r.penalties.away : r.penalties.home})` : '';
    addNews(s, 'match', `${verdict} ${us}-${them} face à ${opp.name}${pens}`, `${s.weeks[f.week].label} — ${home.name} ${r.homeGoals}-${r.awayGoals} ${away.name}.`, ids);
    if (!s.manager.unemployed) {
      boardAfterMatch(s, f);
      staffAfterMatch(s, winner === s.userClubId ? 'W' : winner === null ? 'D' : 'L');
      // Expérience d'entraîneur : résultat, buts marqués, clean sheet.
      const base = winner === s.userClubId ? XP.win : winner === null ? XP.draw : XP.loss;
      addXp(s, base + us * XP.goal + (them === 0 ? XP.cleanSheet : 0), ids);
    }
    learnFromMatch(s, r.participants.filter((id) => byId.get(id)?.clubId === opp.id));
  }

  const crowd = attendance(home, away.reputation, f.competition === 'cup');
  const gateBonus = home.id === s.userClubId ? 1 + fx(s, 'income') : 1;
  addMoney(s, home.id, 'gate', Math.round(gateReceipts(home, crowd) * gateBonus), `Billetterie vs ${away.shortName} (${crowd.toLocaleString('fr-FR')} spectateurs)`);
}

/**
 * Termine la semaine courante : matchs restants, physique, finances, formation, scouting,
 * marché, direction et carrière, puis passage à la semaine suivante.
 */
export function completeWeek(s: GameState, rng: Rng, ids: IdGen, userResult?: { fixtureId: string; result: MatchResult }): void {
  if (isSeasonOver(s)) return;
  const week = s.weeks[s.currentWeek];

  // Les blessures en cours avancent d'une semaine avant les matchs.
  s.players.forEach((p) => {
    if (p.injuryWeeks <= 0) return;
    p.injuryWeeks--;
    if (p.injuryWeeks === 0) {
      if (p.clubId === s.userClubId && p.injury) addNews(s, 'injury', `${fullName(p)} est rétabli`, `${fullName(p)} a récupéré (${p.injury.toLowerCase()}) et peut de nouveau jouer.`, ids);
      p.injury = null;
    }
  });

  for (const f of fixturesOfWeek(s, week.index)) {
    if (f.played) continue;
    const result = userResult && userResult.fixtureId === f.id ? userResult.result : createMatch(s, f, rng).runToEnd();
    applyResult(s, f, result, rng, ids);
  }

  // Finances hebdomadaires de tous les clubs.
  const effects = totalEffects(s);
  for (const club of s.clubs) {
    const isUser = club.id === s.userClubId;
    const income = isUser ? 1 + (effects.income ?? 0) : 1;
    addMoney(s, club.id, 'sponsor', Math.round(weeklySponsor(club) * income), 'Sponsors et partenariats');
    addMoney(s, club.id, 'wages', -wageBill(squadOf(s, club.id)), 'Salaires des joueurs');
    const youthWages = wageBill(youthOf(s, club.id));
    if (youthWages) addMoney(s, club.id, 'wages', -youthWages, 'Salaires du centre de formation');
    addMoney(s, club.id, 'wages', -runningCosts(club), 'Frais de fonctionnement');
    addMoney(s, club.id, 'facilities', -Math.round(facilitiesUpkeep(club) * (isUser ? Math.max(0.5, 1 + (effects.upkeep ?? 0)) : 1)), 'Entretien des infrastructures');
    if (week.competition === 'league') addMoney(s, club.id, 'tv', Math.round(tvRights(club) * income), 'Droits TV');
  }

  if (week.competition === 'cup') progressCup(s, week.round, rng, ids);

  // Physique, progression et formation.
  const clubs = new Map(s.clubs.map((c) => [c.id, c]));
  const recoveryBonus = effects.recovery ?? 0;
  const growthBonus = (effects.youthGrowth ?? 0) * 0.5;
  applyTrainingWeek(s, rng, ids);
  s.players.forEach((p) => weeklyRecovery(p, p.clubId ? clubs.get(p.clubId) : undefined, p.clubId === s.userClubId ? recoveryBonus : 0));
  if (s.currentWeek % 4 === 3) {
    s.players.forEach((p) => p.clubId && !p.youth && monthlyGrowth(p, clubs.get(p.clubId), rng, p.clubId === s.userClubId ? growthBonus : 0));
    youthDevelopment(s, rng);
  }
  if (s.currentWeek === YOUTH_INTAKE_WEEK && !s.manager.unemployed) youthIntake(s, rng, ids);
  s.clubs.forEach((c) => (c.morale = Math.round(c.morale + (60 - c.morale) * 0.05)));
  // Personnages charismatiques et avantages « meneur d'hommes ».
  const moraleBoost = effects.morale ?? 0;
  if (moraleBoost) {
    const club = clubById(s, s.userClubId);
    club.morale = clamp(Math.round(club.morale + moraleBoost), 15, 98);
    squadOf(s, s.userClubId).forEach((p) => (p.morale = clamp(Math.round(p.morale + moraleBoost * 0.5), 5, 100)));
  }

  progressConstruction(s, ids);
  weeklyScouting(s, rng, ids);
  // Staff, missions de recrutement, effets temporaires et événements à choix.
  if (!s.manager.unemployed) {
    const pos = computeStandings(s.clubs.map((c) => c.id), s.fixtures).findIndex((r) => r.clubId === s.userClubId) + 1;
    const target = s.board.objectives.find((o) => o.kind === 'league')?.target ?? 8;
    weeklyStaff(s, rng, ids, pos <= target);
    weeklyMissions(s, rng, ids);
    tickModifiers(s);
    if (s.currentWeek % 8 === 4) refreshStaffMarket(s, rng, ids);
    maybeTriggerEvent(s, rng, ids);
  }
  weeklyMarket(s, rng, ids);

  // Direction et carrière.
  expireJobOffers(s);
  if (!s.manager.unemployed) {
    if (s.currentWeek % 6 === 5) boardReview(s, ids);
    if (s.currentWeek % 8 === 7) midSeasonInterest(s, rng, ids);
    if (shouldSack(s)) sackManager(s, rng, ids);
  }

  s.currentWeek++;
  if (isSeasonOver(s)) endSeason(s, rng, ids);
}

function progressCup(s: GameState, round: number, rng: Rng, ids: IdGen): void {
  const roundFixtures = s.fixtures.filter((f) => f.competition === 'cup' && s.weeks[f.week].round === round);
  const winners = roundFixtures.map(fixtureWinner).filter((x): x is string => !!x);
  winners.forEach((id) => addMoney(s, id, 'prize', CUP_PRIZES[round] ?? 0, `Prime ${CUP_NAME} (${CUP_ROUND_LABELS[round]})`));
  if (winners.includes(s.userClubId)) addXp(s, XP.cupRound, ids);
  const userOut = roundFixtures.some((f) => (f.homeId === s.userClubId || f.awayId === s.userClubId) && fixtureWinner(f) !== s.userClubId);
  if (userOut) addNews(s, 'match', `Élimination en ${CUP_NAME}`, `Votre parcours s'arrête au stade : ${CUP_ROUND_LABELS[round].toLowerCase()}.`, ids);

  if (winners.length === 1) {
    const champ = clubById(s, winners[0]);
    addNews(s, 'season', `${champ.name} remporte la ${CUP_NAME} !`, `${champ.name} soulève le trophée et empoche ${formatM(CUP_PRIZES[round])}.`, ids);
    return;
  }
  const nextWeek = s.weeks.find((w) => w.competition === 'cup' && w.round === round + 1);
  if (nextWeek) s.fixtures.push(...drawCupRound(winners, nextWeek.index, rng, () => ids('f')));
}

export function cupWinner(s: GameState): string | null {
  const final = s.fixtures.find((f) => f.competition === 'cup' && s.weeks[f.week]?.round === CUP_ROUND_LABELS.length - 1);
  return final ? fixtureWinner(final) : null;
}

function endSeason(s: GameState, rng: Rng, ids: IdGen): void {
  const table = computeStandings(s.clubs.map((c) => c.id), s.fixtures, (id) => clubById(s, id).name);
  table.forEach((row, i) => addMoney(s, row.clubId, 'prize', leaguePrize(i + 1, table.length), `Prime de classement (${i + 1}e)`));
  const userPos = table.findIndex((r) => r.clubId === s.userClubId) + 1;
  const champion = clubById(s, table[0].clubId);
  const cup = cupWinner(s);
  s.history.push({ season: s.season, championId: champion.id, cupWinnerId: cup, userPosition: userPos, userClubId: s.userClubId });
  addNews(s, 'season', `${champion.name} champion de ${LEAGUE_NAME} !`, `Fin de la saison ${s.season}-${s.season + 1}. Votre club termine à la ${userPos}e place.`, ids);
  if (s.manager.unemployed) return;
  const achieved = s.board.objectives.filter((o) => objectiveStatus(s, o).status === 'achieved').length;
  addXp(s, achieved * XP.objective + (champion.id === s.userClubId ? XP.league : 0) + (cup === s.userClubId ? XP.cup : 0), ids);
  boardSeasonReview(s, ids);
  const leagueTarget = s.board.objectives.find((o) => o.kind === 'league')?.target ?? 8;
  seasonEndCareer(s, userPos, leagueTarget, champion.id === s.userClubId, cup === s.userClubId, rng, ids);
  if (s.board.confidence < 20) sackManager(s, rng, ids);
}

/** Intersaison : vieillissement, progression, fins de contrat, centre de formation, nouvelle saison. */
export function startNextSeason(s: GameState, rng: Rng, ids: IdGen): void {
  const table = computeStandings(s.clubs.map((c) => c.id), s.fixtures);
  table.forEach((row, i) => {
    const club = clubById(s, row.clubId);
    const delta = i < 3 ? 2 : i >= table.length - 3 ? -2 : 0;
    club.reputation = clamp(club.reputation + delta, 30, 99);
  });

  const retired: Player[] = [];
  for (const p of s.players) {
    p.age++;
    p.rating = clamp(p.rating + development(rng, p), 35, Math.max(p.potential, p.rating));
    if (p.age > 29) p.potential = p.rating;
    p.stats = { appearances: 0, goals: 0, assists: 0, ratingSum: 0 };
    p.fatigue = 0;
    p.injuryWeeks = 0;
    p.injury = null;
    p.form = 5;
    p.recentApps = [];
    p.morale = Math.round(p.morale + (62 - p.morale) * 0.5);
    if (p.clubId && !p.youth) p.contractYears--;
    if (!p.youth && (p.age >= 37 || (p.age >= 34 && rng.chance(0.35)))) retired.push(p);
  }
  const retiredIds = new Set(retired.map((p) => p.id));
  retired
    .filter((p) => p.clubId === s.userClubId)
    .forEach((p) => addNews(s, 'season', `${fullName(p)} prend sa retraite`, `À ${p.age} ans, ${fullName(p)} raccroche les crampons.`, ids));
  s.players = s.players.filter((p) => !retiredIds.has(p.id));
  s.scouting.assignments = s.scouting.assignments.filter((id) => !retiredIds.has(id));

  // Fins de contrat : les joueurs de l'utilisateur partent libres, les clubs IA prolongent.
  for (const p of s.players) {
    if (!p.clubId || p.youth || p.contractYears > 0) continue;
    if (p.clubId === s.userClubId) {
      addNews(s, 'transfer', `Fin de contrat : ${fullName(p)}`, `${fullName(p)} quitte le club libre.`, ids);
      p.clubId = null;
      p.transferListed = false;
      p.releaseClause = null;
    } else {
      p.contractYears = rng.int(1, 3);
      p.wage = Math.max(p.wage, expectedWage(p));
    }
  }

  seasonEndYouth(s, ids);
  seasonStaff(s, rng, ids);

  for (const club of s.clubs) {
    const isUser = club.id === s.userClubId;
    const squad = squadOf(s, club.id);
    // Clubs IA : 2 jeunes formés au club chaque été. Utilisateur : uniquement de quoi éviter un effectif trop court.
    const needed = isUser ? Math.max(0, 18 - squad.length) : Math.max(2, 22 - squad.length);
    for (let i = 0; i < needed; i++) {
      const p = createPlayer(rng, { id: ids('p'), position: rng.pick(SQUAD_TEMPLATE), meanRating: 50 + club.level * 3, clubId: club.id, age: rng.int(17, 19) });
      p.potential = clamp(p.rating + rng.int(10, 28), p.rating, 92);
      p.homegrownClubId = club.id;
      p.squadStatus = 'prospect';
      s.players.push(p);
    }
    const fresh = squadOf(s, club.id);
    if (!isUser) assignStatuses(fresh);
    const bill = wageBill(fresh);
    club.wageBudget = Math.max(club.wageBudget, Math.round(bill * 1.12));
    club.transferBudget = Math.max(club.transferBudget, Math.round(Math.max(0, club.balance) * 0.25));
    club.morale = 60;
    club.tactic.lineup = isUser ? repairLineup(club.tactic, fresh) : autoPickLineup(fresh, club.tactic.formation);
  }

  const freeCount = s.players.filter((p) => !p.clubId).length;
  if (freeCount < 40) s.players.push(...generateFreeAgents(rng, ids, 40 - freeCount));

  s.season++;
  startSeason(s, rng, ids);
}

function development(rng: Rng, p: Player): number {
  if (p.age <= 21) return rng.int(1, 6);
  if (p.age <= 24) return rng.int(0, 4);
  if (p.age <= 29) return rng.int(-1, 1);
  if (p.age <= 32) return rng.int(-3, 0);
  return rng.int(-5, -1);
}
