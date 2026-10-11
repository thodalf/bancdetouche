import { CUP_ROUND_LABELS, Fixture, SeasonWeek } from '../models';
import { Rng } from './rng';

export interface Pairing {
  home: string;
  away: string;
}

/**
 * Calendrier aller-retour par la méthode du « cercle ».
 * Retourne 2 × (n − 1) journées de n/2 matchs ; chaque équipe reçoit chaque adversaire une fois.
 */
export function roundRobin(teamIds: string[]): Pairing[][] {
  const teams = [...teamIds];
  if (teams.length % 2 === 1) teams.push('__bye__');
  const n = teams.length;
  const rounds: Pairing[][] = [];
  const rotating = teams.slice(1);
  for (let r = 0; r < n - 1; r++) {
    const order = [teams[0], ...rotating];
    const round: Pairing[] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = order[i];
      const b = order[n - 1 - i];
      if (a === '__bye__' || b === '__bye__') continue;
      // Alternance domicile/extérieur pour éviter les longues séries.
      const flip = i === 0 ? r % 2 === 1 : (r + i) % 2 === 0;
      round.push(flip ? { home: b, away: a } : { home: a, away: b });
    }
    rounds.push(round);
    rotating.unshift(rotating.pop()!);
  }
  const returnLegs = rounds.map((round) => round.map((m) => ({ home: m.away, away: m.home })));
  return [...rounds, ...returnLegs];
}

/** Semaines de championnat après lesquelles se joue un tour de coupe. */
const CUP_AFTER_MATCHDAY = [3, 9, 15, 21, 26];

function firstSaturdayOfAugust(year: number): Date {
  const d = new Date(Date.UTC(year, 7, 1));
  while (d.getUTCDay() !== 6) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

export interface SeasonPlan {
  weeks: SeasonWeek[];
  fixtures: Fixture[];
}

/** Calendrier de tous les championnats (même rythme de journées) et semaines de coupe. */
export function buildSeason(season: number, leagues: string[][], rng: Rng, nextId: () => string): SeasonPlan {
  const calendars = leagues.map((clubIds) => roundRobin(rng.shuffle(clubIds)));
  const rounds = Array.from({ length: Math.max(...calendars.map((c) => c.length)) }, (_, r) => calendars.flatMap((c) => c[r] ?? []));
  const weeks: SeasonWeek[] = [];
  const fixtures: Fixture[] = [];
  const start = firstSaturdayOfAugust(season);
  const addWeek = (w: Omit<SeasonWeek, 'index' | 'date'>) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + weeks.length * 7);
    weeks.push({ ...w, index: weeks.length, date: date.toISOString().slice(0, 10) });
    return weeks.length - 1;
  };

  let cupRound = 0;
  rounds.forEach((round, r) => {
    const week = addWeek({ competition: 'league', round: r + 1, label: `Journée ${r + 1}` });
    round.forEach((m) => fixtures.push(newFixture(nextId(), 'league', week, m.home, m.away)));
    if (CUP_AFTER_MATCHDAY.includes(r + 1) && cupRound < CUP_ROUND_LABELS.length) {
      addWeek({ competition: 'cup', round: cupRound, label: CUP_ROUND_LABELS[cupRound] });
      cupRound++;
    }
  });
  return { weeks, fixtures };
}

/** Tirage au sort d'un tour de coupe (match sec, l'équipe tirée en premier reçoit). */
export function drawCupRound(teamIds: string[], week: number, rng: Rng, nextId: () => string, cup = 'FRA'): Fixture[] {
  const pot = rng.shuffle(teamIds);
  const out: Fixture[] = [];
  for (let i = 0; i + 1 < pot.length; i += 2) out.push({ ...newFixture(nextId(), 'cup', week, pot[i], pot[i + 1]), cup });
  return out;
}

export function newFixture(id: string, competition: Fixture['competition'], week: number, homeId: string, awayId: string): Fixture {
  return { id, competition, week, homeId, awayId, played: false, homeGoals: 0, awayGoals: 0, events: [] };
}

/** Vainqueur d'un match à élimination directe. */
export function fixtureWinner(f: Fixture): string | null {
  if (!f.played) return null;
  if (f.homeGoals !== f.awayGoals) return f.homeGoals > f.awayGoals ? f.homeId : f.awayId;
  if (f.penalties) return f.penalties.home > f.penalties.away ? f.homeId : f.awayId;
  return null;
}
