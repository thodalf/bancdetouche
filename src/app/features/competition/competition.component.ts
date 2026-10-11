import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { CUP_NAME, LEAGUE_NAME } from '../../core/data/clubs.data';
import { fixtureWinner } from '../../core/engine/schedule';
import { CUP_ROUND_LABELS, Fixture, Player } from '../../core/models';
import { GameStore } from '../../core/services/game-store.service';
import { ClubCrestComponent } from '../../shared/components/club-crest.component';
import { FormGuideComponent } from '../../shared/components/rating.component';
import { MatchDatePipe } from '../../shared/pipes/labels.pipe';

type Tab = 'table' | 'calendar' | 'cup' | 'stats';

import { PlayerLinkComponent } from '../../shared/components/player-link.component';

@Component({
  selector: 'app-competition',
  imports: [PlayerLinkComponent, ClubCrestComponent, FormGuideComponent, MatchDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './competition.component.html',
  styleUrl: './competition.component.scss',
})
export class CompetitionComponent {
  protected readonly store = inject(GameStore);
  protected readonly leagueName = LEAGUE_NAME;
  protected readonly cupName = CUP_NAME;

  protected readonly tab = signal<Tab>('table');
  protected readonly state = computed(() => this.store.state()!);
  protected readonly clubs = this.store.clubsById;

  protected readonly table = computed(() =>
    this.store.standings().map((row, i) => ({ row, pos: i + 1, club: this.clubs().get(row.clubId)! })),
  );

  // ---- calendrier : semaine affichée (suit la semaine courante tant que l'utilisateur ne navigue pas)
  protected readonly viewWeek = linkedSignal(() => Math.min(this.state().currentWeek, this.state().weeks.length - 1));
  protected readonly onlyMine = signal(false);
  protected readonly expanded = signal<string | null>(null);

  protected readonly weekFixtures = computed(() => {
    const s = this.state();
    return s.fixtures.filter((f) => f.week === this.viewWeek());
  });
  protected readonly weekInfo = computed(() => this.state().weeks[this.viewWeek()]);

  protected readonly cupRounds = computed(() => {
    const s = this.state();
    return CUP_ROUND_LABELS.map((label, round) => {
      const week = s.weeks.find((w) => w.competition === 'cup' && w.round === round);
      return {
        label,
        week,
        fixtures: s.fixtures.filter((f) => f.competition === 'cup' && week && f.week === week.index),
      };
    });
  });

  protected readonly scorers = computed(() => this.leaders((p) => p.stats.goals));
  protected readonly assisters = computed(() => this.leaders((p) => p.stats.assists));
  protected readonly bestRated = computed(() =>
    this.state()
      .players.filter((p) => p.clubId && p.stats.appearances >= 5)
      .map((p) => ({ p, v: p.stats.ratingSum / p.stats.appearances }))
      .sort((a, b) => b.v - a.v)
      .slice(0, 12)
      .map(({ p, v }) => ({ p, v: v.toFixed(2), club: this.clubs().get(p.clubId!)! })),
  );

  protected isUser(f: Fixture): boolean {
    const id = this.state().userClubId;
    return f.homeId === id || f.awayId === id;
  }

  protected winnerOf(f: Fixture): string | null {
    return fixtureWinner(f);
  }

  protected weekLabel(f: Fixture): string {
    return this.state().weeks[f.week]?.label ?? '';
  }

  protected step(delta: number): void {
    this.viewWeek.update((w) => Math.max(0, Math.min(this.state().weeks.length - 1, w + delta)));
    this.expanded.set(null);
  }

  protected toggle(id: string): void {
    this.expanded.update((cur) => (cur === id ? null : id));
  }

  private leaders(metric: (p: Player) => number) {
    return this.state()
      .players.filter((p) => p.clubId && metric(p) > 0)
      .sort((a, b) => metric(b) - metric(a) || a.stats.appearances - b.stats.appearances)
      .slice(0, 12)
      .map((p) => ({ p, v: metric(p), club: this.clubs().get(p.clubId!)! }));
  }
}
