import { ClubSeed } from '../data/clubs.data';
import { WORLD_CLUBS } from '../data/leagues.data';
import { Club, DEFAULT_INSTRUCTIONS, GameState, SCHEMA_VERSION } from '../models';
import { createBoard } from './board';
import { initialManagerReputation } from './career';
import { wageBill } from './finance';
import { autoPickLineup } from './lineup';
import { assignStatuses, clamp } from './player-factory';
import { Rng } from './rng';
import { buildSeason, drawCupRound } from './schedule';
import { marketValue, roundMoney } from './valuation';
import { addNews, clubById, countries, countryClubs, generateFreeAgents, generateSquad, IdGen, idGenFor, userLeague } from './world';
import { initialStaff, refreshStaffMarket } from './characters';

export function createNewGame(managerName: string, userClubId: string, seed: number): GameState {
  const rng = new Rng(seed);
  const season = 2026;
  const name = managerName.trim() || 'Entraîneur';
  const state: GameState = {
    schemaVersion: SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    savedAt: null,
    managerName: name,
    userClubId,
    season,
    currentWeek: 0,
    rngSeed: 0,
    clubs: [],
    players: [],
    weeks: [],
    fixtures: [],
    news: [],
    ledger: [],
    offers: [],
    feeAgreements: [],
    negotiations: {},
    history: [],
    board: { confidence: 60, objectives: [], startBalance: 0, reviews: [] },
    manager: { name, reputation: 40, career: [], trophies: [], unemployed: false, xp: 0, level: 1, lifestyle: null, perks: [], perkPoints: 1 },
    jobOffers: [],
    scouting: { knowledge: {}, assignments: [] },
    liveMatch: null,
    boosters: { items: [], opened: 0 },
    pendingPack: null,
    staff: [],
    staffMarket: [],
    missions: [],
    events: [],
    modifiers: [],
    nextId: 1,
  };
  const ids = idGenFor(state);

  for (const { seed, leagueId } of WORLD_CLUBS) addClub(state, seed, leagueId, rng, ids);
  state.players.push(...generateFreeAgents(rng, ids, FREE_AGENTS));

  const userClub = clubById(state, userClubId);
  state.manager.reputation = initialManagerReputation(userClub.reputation);
  state.manager.career.push({ clubId: userClubId, fromSeason: season, fromWeek: 0 });
  setupStaff(state, rng, ids);

  startSeason(state, rng, ids);
  state.rngSeed = rng.state;
  return state;
}

/** Nombre de joueurs libres maintenus sur le marché. */
export const FREE_AGENTS = 160;

/** Crée un club, son effectif et sa tactique. */
export function addClub(state: GameState, seed: ClubSeed, leagueId: string, rng: Rng, ids: IdGen): Club {
  const userClubId = state.userClubId;
  {
    const squad = generateSquad(rng, ids, seed.id, seed.level, leagueId);
    assignStatuses(squad);
    // Quelques joueurs formés au club (quota), de préférence parmi les plus jeunes.
    [...squad]
      .sort((a, b) => a.age - b.age + rng.float(-4, 4))
      .slice(0, rng.int(5, 7))
      .forEach((p) => (p.homegrownClubId = seed.id));
    // Clauses libératoires pour une partie des joueurs.
    squad.forEach((p) => {
      if (rng.chance(0.3)) p.releaseClause = roundMoney(marketValue(p) * rng.float(1.6, 3));
    });
    // Quelques joueurs sur la liste des transferts pour animer le marché.
    if (seed.id !== userClubId) rng.shuffle(squad).slice(0, rng.int(1, 3)).forEach((p) => (p.transferListed = true));
    state.players.push(...squad);
    const club: Club = {
      id: seed.id,
      name: seed.name,
      shortName: seed.shortName,
      city: seed.city,
      colors: { primary: seed.primary, secondary: seed.secondary },
      stadium: seed.stadium,
      capacity: seed.capacity,
      reputation: seed.reputation,
      level: seed.level,
      leagueId,
      balance: Math.round(seed.balanceM * 1_000_000),
      transferBudget: Math.round(seed.transferM * 1_000_000),
      wageBudget: Math.round(wageBill(squad) * 1.15),
      ticketPrice: seed.ticketPrice,
      morale: 60,
      tactic: { formation: '4-3-3', style: 'balanced', instructions: { ...DEFAULT_INSTRUCTIONS }, lineup: [] },
      facilities: {
        stadium: clamp(seed.level, 1, 5),
        training: clamp(seed.level + rng.int(-1, 0), 1, 5),
        academy: clamp(seed.level + rng.int(-1, 1), 1, 5),
        scouting: clamp(seed.level + rng.int(-1, 0), 1, 5),
      },
      construction: null,
      trainingIntensity: 'normal',
    };
    club.tactic.formation = rng.pick(['4-3-3', '4-4-2', '4-2-3-1', '3-5-2'] as const);
    club.tactic.lineup = autoPickLineup(squad, club.tactic.formation);
    state.clubs.push(club);
    return club;
  }
}

/** Prépare le calendrier, la coupe et les objectifs d'une saison. */
export function startSeason(s: GameState, rng: Rng, ids: IdGen): void {
  const leagues = new Map<string, string[]>();
  for (const c of s.clubs) leagues.set(c.leagueId, [...(leagues.get(c.leagueId) ?? []), c.id]);
  const plan = buildSeason(s.season, [...leagues.values()], rng, () => ids('f'));
  s.weeks = plan.weeks;
  s.fixtures = plan.fixtures;
  s.currentWeek = 0;
  s.offers = [];
  s.feeAgreements = [];
  // Coupes nationales : 32 clubs commencent en seizièmes, 16 clubs en huitièmes.
  for (const country of countries()) {
    const clubs = countryClubs(s, country).map((c) => c.id);
    const firstRound = clubs.length > 16 ? 0 : 1;
    const week = s.weeks.find((w) => w.competition === 'cup' && w.round === firstRound);
    if (week) s.fixtures.push(...drawCupRound(clubs, week.index, rng, () => ids('f'), country));
  }

  s.board = createBoard(s, Math.max(45, s.board.confidence));
  const user = clubById(s, s.userClubId);
  addNews(
    s,
    'board',
    `Objectifs de la saison ${s.season}-${s.season + 1}`,
    `La direction de ${user.name} fixe ses attentes en ${userLeague(s).name} et au-delà : ${s.board.objectives.map((o) => o.label.toLowerCase()).join(' ; ')}. ` +
      `Budget transferts : ${(user.transferBudget / 1e6).toFixed(1).replace('.', ',')} M€.`,
    ids,
  );
}

/** Staff de départ (un membre par poste), candidats, et premier rapport du recruteur. */
export function setupStaff(s: GameState, rng: Rng, ids: IdGen): void {
  s.staff = initialStaff(s, rng, ids);
  s.missions = [];
  refreshStaffMarket(s, rng, ids);
  const scout = s.staff.find((m) => m.role === 'scout');
  if (scout) s.boosters.items.push({ id: ids('bi'), tier: 'bronze', focus: 'balanced', scoutName: `${scout.firstName} ${scout.lastName}`, scoutSkill: scout.skill });
}
