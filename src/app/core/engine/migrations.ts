import { CLUB_SEEDS } from '../data/clubs.data';
import { DEFAULT_INSTRUCTIONS, GameState, Player, SCHEMA_VERSION } from '../models';
import { createBoard } from './board';
import { initialManagerReputation } from './career';
import { assignStatuses, clamp } from './player-factory';
import { squadOf } from './world';
import { addClub, FREE_AGENTS, setupStaff } from './new-game';
import { WORLD_CLUBS } from '../data/leagues.data';
import { generateFreeAgents } from './world';
import { Rng } from './rng';
import { idGenFor } from './world';

/**
 * Met à niveau une sauvegarde d'une version antérieure du schéma.
 * Chaque étape transforme la version N en N+1 ; on les enchaîne jusqu'à la version courante.
 */
export function migrate(data: GameState & { schemaVersion?: number; boardTarget?: number }): GameState {
  let version = data.schemaVersion ?? 1;
  if (version < 2) {
    migrateV1toV2(data);
    version = 2;
  }
  if (version < 3) {
    migrateV2toV3(data);
    version = 3;
  }
  if (version < 4) {
    migrateV3toV4(data);
    version = 4;
  }
  if (version < 5) {
    migrateV4toV5(data);
    version = 5;
  }
  if (version < 6) {
    migrateV5toV6(data);
    version = 6;
  }
  if (version < 7) {
    migrateV6toV7(data);
    version = 7;
  }
  data.schemaVersion = SCHEMA_VERSION;
  return data;
}

/** v1 → v2 : moral individuel, contrats détaillés, formation, infrastructures, direction, carrière, scouting. */
function migrateV1toV2(s: GameState & { boardTarget?: number }): void {
  for (const p of s.players as Partial<Player>[]) {
    p.morale ??= 60;
    p.injury ??= p.injuryWeeks ? 'Blessure' : null;
    p.squadStatus ??= 'rotation';
    p.releaseClause ??= null;
    p.youth ??= false;
    p.homegrownClubId ??= null;
    p.recentApps ??= [];
    p.talksBlockedUntil ??= 0;
  }
  for (const club of s.clubs) {
    const level = club.level ?? CLUB_SEEDS.find((c) => c.id === club.id)?.level ?? 3;
    club.facilities ??= { stadium: level, training: level, academy: clamp(level - 1, 1, 5), scouting: level };
    club.construction ??= null;
    club.trainingIntensity ??= 'normal';
    const squad = squadOf(s, club.id);
    assignStatuses(squad);
    // Les plus jeunes de chaque effectif sont considérés comme formés au club.
    [...squad].sort((a, b) => a.age - b.age).slice(0, 5).forEach((p) => (p.homegrownClubId ??= club.id));
  }
  s.ledger = s.ledger.map((e) => ({ ...e, clubId: e.clubId ?? s.userClubId }));
  s.feeAgreements ??= [];
  s.negotiations ??= {};
  s.jobOffers ??= [];
  s.scouting ??= { knowledge: {}, assignments: [] };
  s.history = s.history.map((h) => ({ ...h, userClubId: h.userClubId ?? s.userClubId }));
  const club = s.clubs.find((c) => c.id === s.userClubId)!;
  s.manager ??= {
    name: s.managerName,
    reputation: initialManagerReputation(club.reputation),
    career: [{ clubId: s.userClubId, fromSeason: s.season, fromWeek: 0 }],
    trophies: [],
    unemployed: false,
    xp: 0,
    level: 1,
    lifestyle: null,
    perks: [],
    perkPoints: 1,
  };
  if (!s.board) s.board = createBoard(s, 60);
  delete s.boardTarget;
}

/** v2 → v3 : match en direct persistant, expérience d'entraîneur et boosters. */
function migrateV2toV3(s: GameState): void {
  s.liveMatch ??= null;
  s.pendingPack ??= null;
  s.boosters ??= { inventory: { bronze: 1, silver: 0, gold: 0, elite: 0 }, opened: 0 } as never;
  s.manager.xp ??= 0;
  s.manager.level ??= 1;
}

/** v3 → v4 : consignes tactiques détaillées et positions personnalisées. */
function migrateV3toV4(s: GameState): void {
  for (const club of s.clubs) club.tactic.instructions ??= { ...DEFAULT_INSTRUCTIONS };
  if (s.liveMatch) {
    s.liveMatch.home.tactic.instructions ??= { ...DEFAULT_INSTRUCTIONS };
    s.liveMatch.away.tactic.instructions ??= { ...DEFAULT_INSTRUCTIONS };
  }
}

/** v4 → v5 : staff (personnages), modes de vie, événements, boosters rapportés par les recruteurs. */
function migrateV4toV5(s: GameState): void {
  const old = s.boosters as unknown as { inventory?: Record<string, number>; items?: unknown[]; opened?: number };
  const items: GameState['boosters']['items'] = [];
  s.manager.lifestyle ??= null;
  s.manager.perks ??= [];
  // Les points d'avantage remplacent les boosters gagnés aux passages de niveau.
  s.manager.perkPoints ??= Math.max(1, (s.manager.level ?? 1) - 1);
  s.events ??= [];
  s.modifiers ??= [];
  s.boosters = { items, opened: old?.opened ?? 0 };
  if (!s.staff) {
    const ids = idGenFor(s);
    setupStaff(s, new Rng((s.rngSeed ^ 0x5a5a5a5a) >>> 0), ids);
  }
  // Boosters déjà gagnés : convertis en rapports du recruteur.
  const scout = s.staff.find((m) => m.role === 'scout');
  for (const [tier, count] of Object.entries(old?.inventory ?? {})) {
    for (let i = 0; i < count; i++) {
      s.boosters.items.push({ id: `bm${tier}${i}`, tier: tier as never, focus: 'balanced', scoutName: scout ? `${scout.firstName} ${scout.lastName}` : 'Cellule de recrutement', scoutSkill: scout?.skill ?? 8 });
    }
  }
  if (s.pendingPack && !s.pendingPack.scoutName) s.pendingPack.scoutName = scout ? `${scout.firstName} ${scout.lastName}` : 'Cellule de recrutement';
}

/** v5 → v6 : nouvelles consignes tactiques (rythme, couloir, marquage…) et consignes de scénario. */
function migrateV5toV6(s: GameState): void {
  for (const club of s.clubs) club.tactic.instructions = { ...DEFAULT_INSTRUCTIONS, ...club.tactic.instructions };
  if (s.liveMatch) {
    s.liveMatch.home.tactic.instructions = { ...DEFAULT_INSTRUCTIONS, ...s.liveMatch.home.tactic.instructions };
    s.liveMatch.away.tactic.instructions = { ...DEFAULT_INSTRUCTIONS, ...s.liveMatch.away.tactic.instructions };
  }
}

/**
 * v6 → v7 : plusieurs championnats (deuxième division et ligues étrangères), coupes nationales,
 * effectifs plus fournis. La saison en cours continue telle quelle ; les nouveaux championnats
 * démarrent à la saison suivante.
 */
function migrateV6toV7(s: GameState): void {
  for (const club of s.clubs) club.leagueId ??= 'fr1';
  // La coupe nationale compte désormais un tour de plus (seizièmes) : les tours existants sont décalés.
  const cupWeeks = new Set(s.weeks.filter((w) => w.competition === 'cup').map((w) => w.index));
  for (const w of s.weeks) if (w.competition === 'cup') w.round += 1;
  for (const f of s.fixtures) if (f.competition === 'cup' || cupWeeks.has(f.week)) f.cup ??= 'FRA';
  for (const o of s.board.objectives) if (o.kind === 'cup') o.target += 1;
  const ids = idGenFor(s);
  const rng = new Rng((s.rngSeed ^ 0x7e7e7e7e) >>> 0);
  const existing = new Set(s.clubs.map((c) => c.id));
  for (const { seed, leagueId } of WORLD_CLUBS) if (!existing.has(seed.id)) addClub(s, seed, leagueId, rng, ids);
  const free = s.players.filter((p) => !p.clubId).length;
  if (free < FREE_AGENTS) s.players.push(...generateFreeAgents(rng, ids, FREE_AGENTS - free));
}
