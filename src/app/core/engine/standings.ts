import { Fixture, StandingRow } from '../models';

/** Classement calculé à partir des matchs de championnat joués (jamais stocké : toujours dérivé). */
export function computeStandings(clubIds: string[], fixtures: Fixture[], tieBreakName: (id: string) => string = (id) => id): StandingRow[] {
  const rows = new Map<string, StandingRow>(
    clubIds.map((id) => [id, { clubId: id, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDiff: 0, points: 0, form: [] }]),
  );
  const played = fixtures.filter((f) => f.competition === 'league' && f.played).sort((a, b) => a.week - b.week);
  for (const f of played) {
    const h = rows.get(f.homeId);
    const a = rows.get(f.awayId);
    if (!h || !a) continue;
    apply(h, f.homeGoals, f.awayGoals);
    apply(a, f.awayGoals, f.homeGoals);
  }
  return [...rows.values()].sort(
    (x, y) =>
      y.points - x.points ||
      y.goalDiff - x.goalDiff ||
      y.goalsFor - x.goalsFor ||
      tieBreakName(x.clubId).localeCompare(tieBreakName(y.clubId)),
  );
}

function apply(row: StandingRow, gf: number, ga: number): void {
  row.played++;
  row.goalsFor += gf;
  row.goalsAgainst += ga;
  row.goalDiff = row.goalsFor - row.goalsAgainst;
  const res: 'W' | 'D' | 'L' = gf > ga ? 'W' : gf === ga ? 'D' : 'L';
  if (res === 'W') {
    row.won++;
    row.points += 3;
  } else if (res === 'D') {
    row.drawn++;
    row.points += 1;
  } else {
    row.lost++;
  }
  row.form = [...row.form, res].slice(-5);
}
