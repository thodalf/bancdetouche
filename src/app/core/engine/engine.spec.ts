import { CLUB_SEEDS } from '../data/clubs.data';
import { Rng } from './rng';
import { roundRobin } from './schedule';
import { completeWeek, isSeasonOver, leagueTable, startNextSeason } from './season';
import { LEAGUES } from '../data/leagues.data';
import { computeStandings } from './standings';
import { idGenFor, squadOf } from './world';
import { createNewGame } from './new-game';
import { userBid } from './transfers';
import { defaultOffer, demandsFor, negotiate } from './contracts';
import { checkSquadRules } from './rules';
import { migrate } from './migrations';
import { acceptJob } from './career';
import { applyCommand, createLiveMatch, replayLiveMatch } from './live-match';
import { startingStamina } from './match-engine';
import { addXp, claimCard, discardPack, openBooster, startMission, weeklyMissions, xpToNext } from './boosters';
import { renameClub } from './career';
import { tacticalMods } from './game-plans';
import { DEFAULT_INSTRUCTIONS, SCHEMA_VERSION } from '../models';
import { fireStaff, hireStaff, selectLifestyle, totalEffects, unlockPerk, LIFESTYLES } from './characters';
import { EVENTS, maybeTriggerEvent, recentResults, resolveEvent } from './events';
import { potentialEstimate } from './scouting';
import { recommendPlans } from './game-plans';
import { playerTraits, roleForPosition } from '../models';

describe('roundRobin', () => {
  it('fait se rencontrer chaque équipe deux fois, une à domicile et une à l\'extérieur', () => {
    const ids = Array.from({ length: 16 }, (_, i) => `c${i}`);
    const rounds = roundRobin(ids);
    expect(rounds.length).toBe(30);
    rounds.forEach((r) => {
      expect(r.length).toBe(8);
      const seen = new Set(r.flatMap((m) => [m.home, m.away]));
      expect(seen.size).toBe(16);
    });
    const pairs = new Set(rounds.flat().map((m) => `${m.home}-${m.away}`));
    expect(pairs.size).toBe(16 * 15);
  });
});

describe('computeStandings', () => {
  it('attribue 3 points pour une victoire et 1 pour un nul', () => {
    const base = { competition: 'league' as const, week: 0, played: true, events: [] };
    const table = computeStandings(['a', 'b', 'c'], [
      { ...base, id: '1', homeId: 'a', awayId: 'b', homeGoals: 2, awayGoals: 0 },
      { ...base, id: '2', homeId: 'b', awayId: 'c', homeGoals: 1, awayGoals: 1 },
    ]);
    expect(table.map((r) => [r.clubId, r.points])).toEqual([
      ['a', 3],
      ['c', 1],
      ['b', 1],
    ]);
  });
});

describe('saison complète', () => {
  it('se joue de bout en bout avec des résultats réalistes', () => {
    const state = createNewGame('Test', CLUB_SEEDS[8].id, 42);
    const rng = new Rng(state.rngSeed);
    const ids = idGenFor(state);
    const startBalance = state.clubs.map((c) => c.balance);
    while (!isSeasonOver(state)) completeWeek(state, rng, ids);

    const league = state.fixtures.filter((f) => f.competition === 'league');
    expect(league.every((f) => f.played)).toBe(true);
    const goals = league.reduce((s, f) => s + f.homeGoals + f.awayGoals, 0) / league.length;
    const homeWins = league.filter((f) => f.homeGoals > f.awayGoals).length / league.length;
    const draws = league.filter((f) => f.homeGoals === f.awayGoals).length / league.length;
    const shots = league.reduce((s, f) => s + (f.stats?.shotsHome ?? 0) + (f.stats?.shotsAway ?? 0), 0) / league.length / 2;
    const table = leagueTable(state, 'fr1');
    const report = {
      goals: goals.toFixed(2),
      homeWins: homeWins.toFixed(2),
      draws: draws.toFixed(2),
      shotsPerTeam: shots.toFixed(1),
      table: table.map((r) => `${r.clubId}:${r.points}`).join(' '),
      balanceDelta: state.clubs.map((c, i) => `${c.id}:${((c.balance - startBalance[i]) / 1e6).toFixed(1)}M`).join(' '),
      cupFixtures: state.fixtures.filter((f) => f.competition === 'cup').length,
    };
    console.log(JSON.stringify(report, null, 2));
    expect(goals).toBeGreaterThan(2);
    expect(goals).toBeLessThan(3.6);
    // Coupe de France à 32 clubs (31 matchs), coupes étrangères à 16 clubs (15 matchs).
    const cups = state.fixtures.filter((f) => f.competition === 'cup');
    expect(cups.filter((f) => f.cup === 'FRA').length).toBe(31);
    for (const c of ['ENG', 'ESP', 'ITA', 'GER']) expect(cups.filter((f) => f.cup === c).length).toBe(15);
    expect(state.history.length).toBe(1);
    expect(Object.keys(state.history[0].champions ?? {}).length).toBe(6);

    const relegated = leagueTable(state, 'fr1').slice(-3).map((r) => r.clubId);
    const promoted = leagueTable(state, 'fr2').slice(0, 3).map((r) => r.clubId);
    startNextSeason(state, rng, ids);
    expect(state.season).toBe(2027);
    expect(state.currentWeek).toBe(0);
    state.clubs.forEach((c) => expect(squadOf(state, c.id).length).toBeGreaterThanOrEqual(18));
    // Montées et descentes entre l'Élite et l'Excellence.
    relegated.forEach((id) => expect(state.clubs.find((c) => c.id === id)!.leagueId).toBe('fr2'));
    promoted.forEach((id) => expect(state.clubs.find((c) => c.id === id)!.leagueId).toBe('fr1'));
    expect(state.clubs.filter((c) => c.leagueId === 'fr1').length).toBe(16);
    expect(state.fixtures.filter((f) => f.competition === 'league' && promoted.includes(f.homeId)).length).toBe(3 * 15);
  }, 60_000);
});

describe('transferts et contrats', () => {
  it('signe un joueur libre après négociation et prolonge un contrat', () => {
    const state = createNewGame('Test', 'olv', 7);
    const rng = new Rng(state.rngSeed);
    const ids = idGenFor(state);
    const before = squadOf(state, 'olv').length;
    const free = state.players.filter((p) => !p.clubId).sort((a, b) => a.rating - b.rating)[0];
    expect(userBid(state, free.id, 0, rng).stage).toBe('contract');
    const offer = defaultOffer(demandsFor(state, free));
    expect(negotiate(state, free.id, offer, ids).outcome).toBe('accepted');
    expect(squadOf(state, 'olv').length).toBe(before + 1);

    const own = squadOf(state, 'olv').find((p) => p.age < 30)!;
    state.clubs.find((c) => c.id === 'olv')!.wageBudget *= 2;
    const lowball = { ...defaultOffer(demandsFor(state, own)), wage: 1000 };
    expect(negotiate(state, own.id, lowball, ids).outcome).toBe('rejected');
    const fair = defaultOffer(demandsFor(state, own));
    expect(negotiate(state, own.id, { ...fair, years: 5 }, ids).outcome).not.toBe('invalid');
  });

  it('impose une indemnité convenue avant de négocier avec un joueur sous contrat', () => {
    const state = createNewGame('Test', 'eco', 9);
    const ids = idGenFor(state);
    const target = state.players.find((p) => p.clubId === 'olv')!;
    expect(negotiate(state, target.id, defaultOffer(demandsFor(state, target)), ids).outcome).toBe('invalid');
  });
});

describe('règles et sauvegardes', () => {
  it('les effectifs générés respectent les quotas', () => {
    const state = createNewGame('Test', 'olv', 3);
    for (const club of state.clubs) {
      const checks = checkSquadRules(club, squadOf(state, club.id));
      expect(checks.find((c) => c.id === 'homegrown')!.ok).toBe(true);
      expect(checks.find((c) => c.id === 'nonEu')!.ok).toBe(true);
    }
  });

  it('migre une sauvegarde v1', () => {
    const state = createNewGame('Test', 'olv', 5) as any;
    state.schemaVersion = 1;
    state.boardTarget = 3;
    delete state.board;
    delete state.manager;
    delete state.scouting;
    delete state.boosters;
    delete state.liveMatch;
    state.players.forEach((p: any) => delete p.morale);
    const migrated = migrate(state);
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.clubs[0].tactic.instructions.tempo).toBe('normal');
    expect(migrated.manager.level).toBe(1);
    expect(migrated.boosters.items.length).toBe(1);
    expect(migrated.staff.length).toBeGreaterThan(4);
    expect(migrated.board.objectives.length).toBeGreaterThan(0);
    expect(migrated.players.every((p) => typeof p.morale === 'number')).toBe(true);
  });
});

describe('carrière sur plusieurs saisons', () => {
  it('enchaîne trois saisons avec direction, formation et changements de club', () => {
    const state = createNewGame('Test', 'eco', 11);
    const rng = new Rng(state.rngSeed);
    const ids = idGenFor(state);
    let clubChanges = 0;
    for (let season = 0; season < 3; season++) {
      while (!isSeasonOver(state)) {
        completeWeek(state, rng, ids);
        if (state.manager.unemployed) {
          const offer = state.jobOffers.find((o) => o.status === 'pending')!;
          expect(offer).toBeTruthy();
          expect(acceptJob(state, offer.id, ids).ok).toBe(true);
          clubChanges++;
        }
      }
      startNextSeason(state, rng, ids);
    }
    expect(state.season).toBe(2029);
    expect(state.history.length).toBe(3);
    expect(state.players.some((p) => p.homegrownClubId === state.userClubId)).toBe(true);
    expect(state.news.some((n) => n.kind === 'youth')).toBe(true);
    console.log(JSON.stringify({ clubChanges, rep: state.manager.reputation, confidence: state.board.confidence, club: state.userClubId }));
  }, 120_000);
});

describe('match en direct', () => {
  it('rejoue à l’identique un match interrompu, décisions comprises', () => {
    const state = createNewGame('Test', 'olv', 21);
    const f = state.fixtures.find((x) => x.week === 0 && (x.homeId === 'olv' || x.awayId === 'olv'))!;
    const live = createLiveMatch(state, f, false);
    const sim = replayLiveMatch(live, 0);
    for (let i = 0; i < 30; i++) sim.step();
    const side = live.userSide;
    const out = sim.onField(side).find((x) => x.role !== 'GK')!.player.id;
    const inn = sim.benchOf(side)[0].id;
    live.commands.push({ minute: sim.minute, kind: 'sub', outId: out, inId: inn });
    applyCommand(sim, side, live.commands[0]);
    live.commands.push({ minute: sim.minute, kind: 'formation', formation: '4-4-2' });
    applyCommand(sim, side, live.commands[1]);
    for (let i = 0; i < 25; i++) sim.step();
    live.minute = sim.minute;

    const rebuilt = replayLiveMatch(live);
    expect(rebuilt.minute).toBe(sim.minute);
    expect([rebuilt.homeGoals, rebuilt.awayGoals]).toEqual([sim.homeGoals, sim.awayGoals]);
    expect(rebuilt.events.map((e) => e.text)).toEqual(sim.events.map((e) => e.text));
    expect(rebuilt.formationOf(side)).toBe('4-4-2');
    expect(rebuilt.subsLeft(side)).toBe(sim.subsLeft(side));
    expect(rebuilt.runToEnd().homeGoals).toBe(sim.runToEnd().homeGoals);
  });
});

describe('boosters et niveaux', () => {
  it('monte de niveau et gagne des points d’avantage', () => {
    const state = createNewGame('Test', 'olv', 33);
    const ids = idGenFor(state);
    const before = state.manager.perkPoints;
    addXp(state, xpToNext(1) + xpToNext(2) + 10, ids);
    expect(state.manager.level).toBe(3);
    expect(state.manager.perkPoints).toBe(before + 2);
  });

  it('un recruteur part en mission, rapporte un booster, on signe une carte', () => {
    const state = createNewGame('Test', 'olv', 33);
    const rng = new Rng(state.rngSeed);
    const ids = idGenFor(state);
    const scout = state.staff.find((m) => m.role === 'scout')!;
    expect(state.boosters.items.length).toBe(1);
    expect(startMission(state, scout.id, 'youth', 2, ids).ok).toBe(true);
    expect(startMission(state, scout.id, 'youth', 2, ids).ok).toBe(false);
    for (let i = 0; i < 2; i++) weeklyMissions(state, rng, ids);
    expect(state.missions.length).toBe(0);
    expect(scout.missionId).toBeNull();
    expect(state.boosters.items.length).toBe(2);
    const item = state.boosters.items[1];
    expect(item.scoutName).toBe(`${scout.firstName} ${scout.lastName}`);
    expect(openBooster(state, item.id, rng, ids).ok).toBe(true);
    expect(state.pendingPack!.cards.length).toBeGreaterThan(2);
    expect(state.pendingPack!.cards.every((c) => c.age <= 21)).toBe(true);
    const before = squadOf(state, 'olv').length;
    state.clubs.find((c) => c.id === 'olv')!.wageBudget *= 2;
    expect(claimCard(state, state.pendingPack!.cards[0].id, ids).ok).toBe(true);
    expect(squadOf(state, 'olv').length).toBe(before + 1);
    expect(state.pendingPack).toBeNull();
  });

  it('estime le potentiel sans jamais révéler le chiffre exact d’un inconnu', () => {
    const state = createNewGame('Test', 'olv', 44);
    const stranger = state.players.find((p) => !p.clubId)!;
    expect(potentialEstimate(state, stranger)).toBeNull();
    const own = state.players.find((p) => p.clubId === 'olv')!;
    const est = potentialEstimate(state, own)!;
    expect(est.min).toBeLessThanOrEqual(est.max);
    expect(est.stars).toBeGreaterThanOrEqual(0.5);
  });
});

describe('consignes tactiques', () => {
  it('une approche offensive produit plus de buts qu’un bloc défensif', () => {
    const state = createNewGame('Test', 'olv', 55);
    const f = state.fixtures.find((x) => x.week === 0)!;
    const goals = (plan: 'allOut' | 'killGame') => {
      let total = 0;
      for (let i = 0; i < 60; i++) {
        const live = createLiveMatch(state, f, false);
        live.seed = 1000 + i;
        const sim = replayLiveMatch(live, 0);
        sim.applyPlan('home', plan);
        sim.applyPlan('away', plan);
        const r = sim.runToEnd();
        total += r.homeGoals + r.awayGoals;
      }
      return total / 60;
    };
    const open = goals('allOut');
    const closed = goals('killGame');
    console.log(JSON.stringify({ open, closed }));
    expect(open).toBeGreaterThan(closed);
  });

  it('déduit le poste de la position sur le terrain', () => {
    expect(roleForPosition(50, 15)).toBe('ST');
    expect(roleForPosition(10, 72)).toBe('LB');
    expect(roleForPosition(50, 60)).toBe('DM');
    expect(roleForPosition(85, 35)).toBe('RW');
  });

  it('recommande des plans selon le scénario', () => {
    expect(recommendPlans({ minute: 85, diff: -1, ownReds: 0, oppReds: 0, ownYellows: 0, energy: 60, balance: 1 })).toContain('allOut');
    expect(recommendPlans({ minute: 80, diff: 1, ownReds: 0, oppReds: 0, ownYellows: 0, energy: 60, balance: 1 })[0]).toBe('killGame');
    expect(recommendPlans({ minute: 40, diff: 0, ownReds: 1, oppReds: 0, ownYellows: 1, energy: 70, balance: 1 })[0]).toBe('compact');
  });
});

describe('personnages (staff, modes de vie, événements)', () => {
  it('agrège les effets du staff et des avantages', () => {
    const state = createNewGame('Test', 'olv', 44);
    const ids = idGenFor(state);
    const base = totalEffects(state);
    expect(base.matchStrength ?? 0).toBeGreaterThan(0);
    expect(unlockPerk(state, 'tac1').ok).toBe(false); // pas de mode de vie
    selectLifestyle(state, 'tactician');
    expect(unlockPerk(state, LIFESTYLES.tactician.perks[1].id).ok).toBe(false); // ordre
    expect(unlockPerk(state, LIFESTYLES.tactician.perks[0].id).ok).toBe(true);
    expect(state.manager.perkPoints).toBe(0);
    const after = totalEffects(state);
    expect(Object.keys(after).some((k) => (after as any)[k] !== (base as any)[k])).toBe(true);

    const assistant = state.staff.find((m) => m.role === 'assistant')!;
    const candidate = state.staffMarket.find((m) => m.role === 'assistant');
    if (candidate) {
      state.manager.reputation = 100;
      state.clubs.find((c) => c.id === 'olv')!.balance += 50_000_000;
      expect(hireStaff(state, candidate.id, ids).ok).toBe(true);
      expect(state.staff.filter((m) => m.role === 'assistant').length).toBe(1);
      expect(state.staff.some((m) => m.id === assistant.id)).toBe(false);
    }
    const doctor = state.staff.find((m) => m.role === 'doctor')!;
    expect(fireStaff(state, doctor.id, ids).ok).toBe(true);
    expect(state.staff.some((m) => m.role === 'doctor')).toBe(false);
  });

  it('résout un événement et applique ses modificateurs', () => {
    const state = createNewGame('Test', 'olv', 45);
    const rng = new Rng(state.rngSeed);
    const ids = idGenFor(state);
    const fitness = state.staff.find((m) => m.role === 'fitness')!;
    state.events.push({ id: 'e1', defId: 'new-method', staffId: fitness.id, season: state.season, week: 0 });
    const before = totalEffects(state).recovery ?? 0;
    expect(resolveEvent(state, 'e1', 0, rng, ids)).not.toBe('');
    expect(state.events.length).toBe(0);
    expect(state.modifiers.length).toBe(2);
    expect(totalEffects(state).recovery).toBeCloseTo(before + 0.15);
  });
});

describe('round 6', () => {
  it('applique automatiquement une consigne de scénario en match', () => {
    const state = createNewGame('Test', 'olv', 61);
    const club = state.clubs.find((c) => c.id === 'olv')!;
    club.tactic.scenarios = { drawing: { plan: 'wingPlay', from: 0 } };
    const f = state.fixtures.find((x) => x.week === 0 && (x.homeId === 'olv' || x.awayId === 'olv'))!;
    const live = createLiveMatch(state, f, false);
    const sim = replayLiveMatch(live, 0);
    sim.step();
    expect(sim.instructionsOf(live.userSide).focus).toBe('flanks');
    expect(sim.events.some((e) => e.text.includes('consigne de scénario'))).toBe(true);
    // Rejouable à l'identique.
    for (let i = 0; i < 20; i++) sim.step();
    live.minute = sim.minute;
    expect(replayLiveMatch(live).events.map((e) => e.text)).toEqual(sim.events.map((e) => e.text));
  });

  it('les nouvelles consignes dépendent de l’adversaire', () => {
    const flanks = { ...DEFAULT_INSTRUCTIONS, focus: 'flanks' as const };
    const vsNarrow = tacticalMods('balanced', flanks, false, { ...DEFAULT_INSTRUCTIONS, width: 'narrow' });
    const vsWide = tacticalMods('balanced', flanks, false, { ...DEFAULT_INSTRUCTIONS, width: 'wide' });
    expect(vsNarrow.att).toBeGreaterThan(vsWide.att);
    const trap = { ...DEFAULT_INSTRUCTIONS, line: 'high' as const, offsideTrap: true };
    expect(tacticalMods('balanced', trap, false, { ...DEFAULT_INSTRUCTIONS, passing: 'direct' }).concede).toBeGreaterThan(
      tacticalMods('balanced', trap, false, { ...DEFAULT_INSTRUCTIONS, passing: 'short' }).concede,
    );
  });

  it('les joueurs d’un booster non signés restent sur le marché', () => {
    const state = createNewGame('Test', 'olv', 62);
    const rng = new Rng(state.rngSeed);
    const ids = idGenFor(state);
    expect(openBooster(state, state.boosters.items[0].id, rng, ids).ok).toBe(true);
    const cards = state.pendingPack!.cards.map((c) => c.id);
    discardPack(state);
    const released = state.players.filter((p) => cards.includes(p.id));
    expect(released.length).toBe(cards.length);
    expect(released.every((p) => p.clubId === null && !!p.scoutedBy && state.scouting.knowledge[p.id] > 0)).toBe(true);
  });

  it('renomme le club avec validation', () => {
    const state = createNewGame('Test', 'olv', 63);
    const ids = idGenFor(state);
    const other = state.clubs.find((c) => c.id !== 'olv')!;
    const base = { name: 'Kilomètre Zéro FC', shortName: 'kmz', stadium: 'Stade du Marais', primary: '#123456', secondary: '#abcdef' };
    expect(renameClub(state, { ...base, name: other.name }, ids).ok).toBe(false);
    expect(renameClub(state, { ...base, shortName: 'TROPLONG' }, ids).ok).toBe(false);
    expect(renameClub(state, base, ids).ok).toBe(true);
    const club = state.clubs.find((c) => c.id === 'olv')!;
    expect([club.name, club.shortName, club.stadium, club.colors.primary]).toEqual(['Kilomètre Zéro FC', 'KMZ', 'Stade du Marais', '#123456']);
  });

  it('déclenche un événement de crise après une série de défaites', () => {
    const state = createNewGame('Test', 'olv', 64);
    const rng = new Rng(7);
    const ids = idGenFor(state);
    const mine = state.fixtures.filter((f) => f.homeId === 'olv' || f.awayId === 'olv').sort((a, b) => a.week - b.week).slice(0, 3);
    mine.forEach((f) => {
      f.played = true;
      f.homeGoals = f.homeId === 'olv' ? 0 : 2;
      f.awayGoals = f.homeId === 'olv' ? 2 : 0;
    });
    expect(recentResults(state, 3)).toEqual(['L', 'L', 'L']);
    for (let i = 0; i < 30 && !state.events.length; i++) maybeTriggerEvent(state, rng, ids);
    expect(state.events[0]?.defId).toBe('losing-streak');
    expect(resolveEvent(state, state.events[0].id, 0, rng, ids)).not.toBe('');
  }, 60_000);
});

describe('événements (catalogue complet)', () => {
  it('chaque option de chaque événement s’applique sans erreur', () => {
    const base = createNewGame('Test', 'olv', 70);
    for (const def of EVENTS) {
      def.options.forEach((_o, i) => {
        const s = structuredClone(base);
        const rng = new Rng(i + 1);
        const ids = idGenFor(s);
        const staff = def.pickStaff?.(s) ?? (def.role ? s.staff.find((m) => m.role === def.role) : undefined);
        const player = def.pickPlayer?.(s) ?? s.players.find((p) => p.clubId === 'olv');
        const player2 = def.pickPlayer2?.(s, player);
        const club = def.pickClub?.(s) ?? s.clubs.find((c) => c.id !== 'olv');
        s.events.push({ id: 'ev', defId: def.id, staffId: staff?.id, staff2Id: def.pickStaff2?.(s, staff)?.id, playerId: player?.id, player2Id: player2?.id, clubId: club?.id, season: s.season, week: 0 });
        const option = def.options[i];
        if (option.requires) {
          // Option réservée : refusée sans le prérequis, puis débloquée.
          s.manager.lifestyle = null;
          s.staff.forEach((m) => (m.traits = m.traits.filter((x) => x !== 'meticulous' && x !== 'diplomat')));
          s.players.forEach((p) => (p.traits = []));
          expect(resolveEvent(s, 'ev', i, rng, ids)).toBe('');
          expect(s.events.length).toBe(1);
          s.players.filter((p) => p.clubId === 'olv').forEach((p) => (p.traits = ['loyal', 'leader']));
          s.staff.forEach((m) => m.traits.push('meticulous', 'diplomat'));
          for (const l of ['tactician', 'mentor', 'negotiator', 'leader', 'steward'] as const) {
            s.manager.lifestyle = l;
            if (option.requires.test(s, { staff, player, player2, club })) break;
          }
        }
        expect(() => resolveEvent(s, 'ev', i, rng, ids), `${def.id} #${i}`).not.toThrow();
        expect(s.events.length).toBe(0);
        expect(def.text({ staff, player, player2, club }, s).length).toBeGreaterThan(10);
      });
    }
  }, 120_000);

  it('programme et déclenche la suite d’une chaîne d’événements', () => {
    const s = createNewGame('Test', 'olv', 71);
    const rng = new Rng(3);
    const ids = idGenFor(s);
    const assistant = s.staff.find((m) => m.role === 'assistant')!;
    s.events.push({ id: 'e1', defId: 'tactical-innovation', staffId: assistant.id, season: s.season, week: 0 });
    resolveEvent(s, 'e1', 0, rng, ids);
    expect(s.eventQueue?.length).toBe(1);
    maybeTriggerEvent(s, rng, ids);
    expect(s.events.length).toBe(0); // pas encore l'heure
    s.currentWeek += 3;
    maybeTriggerEvent(s, rng, ids);
    expect(s.events[0]?.defId).toBe('tactical-innovation-result');
    expect(s.events[0]?.staffId).toBe(assistant.id);
  });
});

describe('animation du match', () => {
  it('chaque action désigne de vrais acteurs, cohérents avec les faits de jeu', () => {
    const state = createNewGame('Test', 'olv', 80);
    const f = state.fixtures.find((x) => x.week === 0 && (x.homeId === 'olv' || x.awayId === 'olv'))!;
    const live = createLiveMatch(state, f, false);
    const sim = replayLiveMatch(live, 0);
    let lastSeq = 0;
    let goals = 0;
    while (!sim.finished) {
      const events = sim.step();
      const actions = sim.minuteActions;
      const onField = new Set([...sim.onField('home'), ...sim.onField('away')].map((x) => x.player.id));
      for (const a of actions) {
        expect(a.seq).toBeGreaterThan(lastSeq);
        lastSeq = a.seq;
        if (['shot', 'goal', 'save', 'miss'].includes(a.kind)) expect(a.playerId).toBeTruthy();
      }
      for (const e of events.filter((x) => x.type === 'goal')) {
        goals++;
        const g = actions.find((a) => a.kind === 'goal' && a.playerId === e.playerId);
        expect(g).toBeTruthy();
        // Le tir précède le but et c'est le même joueur.
        const shot = actions[actions.indexOf(g!) - 1];
        expect(shot.kind).toBe('shot');
        expect(shot.playerId).toBe(e.playerId);
        expect(g!.assistId ?? null).toBe(e.assistId ?? null);
      }
      for (const a of actions.filter((x) => x.kind === 'possession' || x.kind === 'attack')) {
        if (a.playerId) expect(onField.has(a.playerId) || events.some((e) => e.type === 'red' || e.type === 'injury')).toBe(true);
      }
    }
    expect(goals).toBe(sim.homeGoals + sim.awayGoals);
  });
});

describe('chaîne en trois actes', () => {
  it('le prodige : essai, intégration au centre, tentative de débauchage', () => {
    const s = createNewGame('Test', 'olv', 90);
    const rng = new Rng(5);
    const ids = idGenFor(s);
    const scout = s.staff.find((m) => m.role === 'scout')!;
    s.events.push({ id: 'p1', defId: 'prodigy-tip', staffId: scout.id, season: s.season, week: 0 });
    resolveEvent(s, 'p1', 0, rng, ids);
    s.currentWeek += 2;
    maybeTriggerEvent(s, rng, ids);
    expect(s.events[0].defId).toBe('prodigy-trial');
    const youthBefore = s.players.filter((p) => p.youth && p.clubId === 'olv').length;
    resolveEvent(s, s.events[0].id, 0, rng, ids);
    expect(s.players.filter((p) => p.youth && p.clubId === 'olv').length).toBe(youthBefore + 1);
    s.currentWeek += 6;
    maybeTriggerEvent(s, rng, ids);
    expect(s.events[0].defId).toBe('prodigy-rival');
    expect(s.events[0].playerId).toBeTruthy();
  });
});

describe('scénarios de joueurs', () => {
  it('personnalités stables et duel pour une place avec suite', () => {
    const s = createNewGame('Test', 'olv', 95);
    const rng = new Rng(9);
    const ids = idGenFor(s);
    const squad = s.players.filter((p) => p.clubId === 'olv');
    expect(squad.map((p) => playerTraits(p))).toEqual(squad.map((p) => playerTraits(p)));
    expect(squad.some((p) => playerTraits(p).length > 0)).toBe(true);
    const [a, b] = squad.filter((p) => p.position === 'CB');
    s.events.push({ id: 'b1', defId: 'position-battle', playerId: a.id, player2Id: b.id, season: s.season, week: 0 });
    resolveEvent(s, 'b1', 0, rng, ids);
    expect(a.squadStatus).toBe('regular');
    s.currentWeek += 4;
    maybeTriggerEvent(s, rng, ids);
    expect(s.events[0].defId).toBe('battle-aftermath');
    expect(s.events[0].playerId).toBe(b.id); // le perdant
  });
});

describe('reconversion', () => {
  it('un vétéran qui raccroche devient entraîneur adjoint avec des traits hérités', () => {
    const s = createNewGame('Test', 'olv', 97);
    const rng = new Rng(4);
    const ids = idGenFor(s);
    const vet = s.players.find((p) => p.clubId === 'olv')!;
    vet.age = 35;
    vet.traits = ['leader', 'professional'];
    s.events.push({ id: 'r1', defId: 'retirement', playerId: vet.id, season: s.season, week: 0 });
    resolveEvent(s, 'r1', 0, rng, ids);
    expect(s.players.some((p) => p.id === vet.id)).toBe(false);
    const assistant = s.staff.filter((m) => m.role === 'assistant');
    expect(assistant.length).toBe(1);
    expect(assistant[0].lastName).toBe(vet.lastName);
    expect(assistant[0].traits).toEqual(expect.arrayContaining(['charismatic', 'meticulous', 'veteran']));
  });
});

import { answerPress, applyTrainingWeek, choosePrep, ensureWeekPlan, prepOptions, setSession, talkToPlayer, weekMatchEffect, weekPlan } from './week';
import { sideInput } from './season';

describe('semaine de travail', () => {
  it('entraînement, préparation et presse modifient le prochain match', () => {
    const s = createNewGame('Test', 'olv', 101);
    const rng = new Rng(2);
    const ids = idGenFor(s);
    const defaultEffect = weekMatchEffect(s).strength;
    const base = sideInput(s, 'olv').boost ?? 0;
    for (let d = 0; d < 5; d++) setSession(s, d, 'tactical');
    expect(weekMatchEffect(s).strength).toBeCloseTo(0.018);
    const best = [...prepOptions(s)].sort((a, b) => b.fit - a.fit)[0];
    choosePrep(s, best.id);
    expect(weekMatchEffect(s).strength).toBeGreaterThan(0.018 + 0.004);
    const plan = ensureWeekPlan(s);
    expect(plan.pressIds.length).toBeGreaterThan(0);
    expect(answerPress(s, 0, 0).ok).toBe(true);
    expect(answerPress(s, 0, 1).ok).toBe(false);
    expect((sideInput(s, 'olv').boost ?? 0) - base).toBeCloseTo(weekMatchEffect(s).strength - defaultEffect);
    // Fin de semaine : la fatigue de l'entraînement s'applique et le plan est remis à zéro.
    const p = s.players.find((x) => x.clubId === 'olv')!;
    p.fatigue = 10;
    applyTrainingWeek(s, rng, ids);
    expect(p.fatigue).toBe(20);
    expect(s.weekPlan).toBeUndefined();
    expect(weekPlan(s).sessions.length).toBe(5);
  });

  it('les entretiens réagissent à la personnalité', () => {
    const s = createNewGame('Test', 'olv', 102);
    const [a, b, c] = s.players.filter((x) => x.clubId === 'olv');
    a.traits = ['temperamental'];
    a.morale = 60;
    b.traits = ['professional'];
    b.morale = 60;
    b.form = 5;
    expect(talkToPlayer(s, a.id, 'demand').ok).toBe(true);
    expect(a.morale).toBe(50);
    expect(talkToPlayer(s, b.id, 'demand').ok).toBe(true);
    expect(b.form).toBe(6.5);
    expect(talkToPlayer(s, b.id, 'praise').ok).toBe(false); // déjà vu
    expect(talkToPlayer(s, c.id, 'praise').ok).toBe(false); // limite de 2
  });

  it('la causerie de mi-temps est rejouée à l’identique', () => {
    const state = createNewGame('Test', 'olv', 103);
    const f = state.fixtures.find((x) => x.week === 0 && (x.homeId === 'olv' || x.awayId === 'olv'))!;
    const live = createLiveMatch(state, f, false);
    const sim = replayLiveMatch(live, 0);
    while (sim.minute < 45) sim.step();
    const cmd = { minute: 45, kind: 'talk' as const, tone: 'angry' as const };
    expect(applyCommand(sim, live.userSide, cmd)).toBeNull();
    expect(applyCommand(sim, live.userSide, cmd)).not.toBeNull(); // une seule causerie
    live.commands.push(cmd);
    sim.runToEnd();
    live.minute = 90;
    const again = replayLiveMatch(live);
    expect(again.events.map((e) => e.text)).toEqual(sim.events.map((e) => e.text));
    expect(sim.events.some((e) => e.text.startsWith('Causerie'))).toBe(true);
  });

  it('la condition physique baisse en match et un entrant est frais', () => {
    const state = createNewGame('Test', 'olv', 104);
    const f = state.fixtures.find((x) => x.week === 0 && (x.homeId === 'olv' || x.awayId === 'olv'))!;
    const live = createLiveMatch(state, f, false);
    const side = live.userSide;
    const squad = live[side].squad;
    const tired = squad.find((p) => live[side].tactic.lineup.includes(p.id))!;
    tired.fatigue = 50;
    const sim = replayLiveMatch(live, 0);
    const start = sim.onField(side).find((x) => x.player.id === tired.id)!.stamina;
    expect(start).toBe(70);
    while (sim.minute < 60) sim.step();
    const field = sim.onField(side);
    const outfield = field.filter((x) => x.role !== 'GK');
    expect(outfield.every((x) => x.stamina < 100)).toBe(true);
    // Un gardien s'use bien moins qu'un joueur de champ.
    const gk = field.find((x) => x.role === 'GK');
    if (gk) expect(sim.staminaOf(side, gk.player.id)).toBeGreaterThan(startingStamina(gk.player) - 10);
    const out = outfield.sort((a, b) => a.stamina - b.stamina)[0];
    const sub = sim.benchOf(side)[0];
    sub.fatigue = 0;
    const subStart = sim.staminaOf(side, sub.id);
    expect(applyCommand(sim, side, { minute: sim.minute, kind: 'sub', outId: out.player.id, inId: sub.id })).toBeNull();
    expect(sim.onField(side).find((x) => x.player.id === sub.id)!.stamina).toBe(subStart);
    expect(subStart).toBeGreaterThan(out.stamina);
  });
});

describe('monde', () => {
  it('six championnats, des effectifs locaux et un marché fourni', () => {
    const s = createNewGame('Test', 'srb', 9);
    expect(s.clubs.length).toBe(96);
    for (const l of LEAGUES) expect(s.clubs.filter((c) => c.leagueId === l.id).length).toBe(16);
    expect(s.players.filter((p) => !p.clubId).length).toBe(160);
    s.clubs.forEach((c) => expect(squadOf(s, c.id).length).toBe(26));
    // Un club anglais aligne surtout des joueurs britanniques, un club français surtout des Français.
    const share = (clubId: string, nats: string[]) => {
      const squad = squadOf(s, clubId);
      return squad.filter((p) => nats.includes(p.nationality)).length / squad.length;
    };
    const en = s.clubs.filter((c) => c.leagueId === 'en1').map((c) => share(c.id, ['ENG', 'SCO', 'WAL', 'IRL']));
    expect(en.reduce((a, b) => a + b, 0) / en.length).toBeGreaterThan(0.45);
    // La deuxième division est plus faible que l'élite.
    const avg = (leagueId: string) => {
      const ps = s.players.filter((p) => p.clubId && s.clubs.find((c) => c.id === p.clubId)!.leagueId === leagueId);
      return ps.reduce((a, p) => a + p.rating, 0) / ps.length;
    };
    expect(avg('fr2')).toBeLessThan(avg('fr1') - 4);
    // Le club de l'entraîneur respecte les règles de composition dès le départ, et la direction vise la montée.
    const club = s.clubs.find((c) => c.id === 'srb')!;
    expect(checkSquadRules(club, squadOf(s, 'srb')).every((r) => r.ok)).toBe(true);
    expect(s.board.objectives.find((o) => o.kind === 'league')!.label).toContain('Monter');
    // Noms variés : peu de doublons parmi plus de 2 500 joueurs.
    const names = new Set(s.players.map((p) => `${p.firstName} ${p.lastName}`));
    expect(names.size / s.players.length).toBeGreaterThan(0.9);
  });

  it('migre une sauvegarde à un seul championnat (v6)', () => {
    const s = createNewGame('Test', 'olv', 13) as any;
    // Sauvegarde v6 simulée : seulement l'élite, coupe à 4 tours.
    const fr1 = new Set(s.clubs.filter((c: any) => c.leagueId === 'fr1').map((c: any) => c.id));
    s.clubs = s.clubs.filter((c: any) => fr1.has(c.id));
    s.clubs.forEach((c: any) => delete c.leagueId);
    s.players = s.players.filter((p: any) => !p.clubId || fr1.has(p.clubId));
    s.fixtures = s.fixtures.filter((f: any) => fr1.has(f.homeId) && f.competition === 'league');
    s.weeks.filter((w: any) => w.competition === 'cup').forEach((w: any) => (w.round = Math.max(0, w.round - 1)));
    s.schemaVersion = 6;
    const m = migrate(s);
    expect(m.clubs.length).toBe(96);
    expect(m.clubs.filter((c) => c.leagueId === 'fr1').length).toBe(16);
    const rng = new Rng(m.rngSeed);
    const ids = idGenFor(m);
    while (!isSeasonOver(m)) completeWeek(m, rng, ids);
    startNextSeason(m, rng, ids);
    // Les nouveaux championnats démarrent à la saison suivante.
    expect(m.fixtures.filter((f) => f.competition === 'league').length).toBe(6 * 8 * 30);
  }, 60_000);
});
