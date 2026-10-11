import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { CUP_NAMES, leagueDef, LEAGUES } from '../../core/data/leagues.data';
import { fixtureWinner } from '../../core/engine/schedule';
import { CUP_ROUND_LABELS, Fixture, MatchEvent, Player } from '../../core/models';
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
  protected readonly leagues = LEAGUES;

  protected readonly tab = signal<Tab>('table');
  protected readonly state = computed(() => this.store.state()!);
  protected readonly clubs = this.store.clubsById;

  /** Championnat affiché (celui de l'entraîneur par défaut). */
  protected readonly leagueId = linkedSignal(() => this.store.userLeague().id);
  protected readonly league = computed(() => leagueDef(this.leagueId()));
  protected readonly leagueName = computed(() => this.league().name);
  protected readonly cupName = computed(() => CUP_NAMES[this.league().country] ?? 'Coupe nationale');
  private readonly leagueClubIds = computed(() => new Set(this.state().clubs.filter((c) => c.leagueId === this.leagueId()).map((c) => c.id)));
  /** Coupe du pays du championnat affiché. */
  private readonly country = computed(() => this.league().country);

  protected readonly table = computed(() =>
    this.store.standingsFor(this.leagueId()).map((row, i) => ({ row, pos: i + 1, club: this.clubs().get(row.clubId)! })),
  );

  /** Zone du classement : titre / montée en haut, relégation en bas. */
  protected zone(pos: number, total: number): 'top' | 'bottom' | null {
    const l = this.league();
    if (pos <= (l.up ? (l.swap ?? 3) : 3)) return 'top';
    if (l.down && pos > total - (l.swap ?? 3)) return 'bottom';
    return null;
  }

  // ---- calendrier : semaine affichée (suit la semaine courante tant que l'utilisateur ne navigue pas)
  protected readonly viewWeek = linkedSignal(() => Math.min(this.state().currentWeek, this.state().weeks.length - 1));
  protected readonly onlyMine = signal(false);
  protected readonly expanded = signal<string | null>(null);

  protected readonly weekFixtures = computed(() => {
    const s = this.state();
    const ids = this.leagueClubIds();
    const country = this.country();
    return s.fixtures.filter((f) => f.week === this.viewWeek() && (f.competition === 'cup' ? (f.cup ?? 'FRA') === country : ids.has(f.homeId)));
  });
  protected readonly weekInfo = computed(() => this.state().weeks[this.viewWeek()]);

  protected readonly cupRounds = computed(() => {
    const s = this.state();
    return CUP_ROUND_LABELS.map((label, round) => ({ label, round })).map(({ label, round }) => {
      const week = s.weeks.find((w) => w.competition === 'cup' && w.round === round);
      return {
        label,
        round,
        week,
        fixtures: s.fixtures.filter((f) => f.competition === 'cup' && (f.cup ?? 'FRA') === this.country() && week && f.week === week.index),
      };
    }).filter((r) => r.fixtures.length || r.round > 0);
  });

  protected readonly scorers = computed(() => this.leaders((p) => p.stats.goals));
  protected readonly assisters = computed(() => this.leaders((p) => p.stats.assists));
  protected readonly bestRated = computed(() =>
    this.state()
      .players.filter((p) => p.clubId && this.leagueClubIds().has(p.clubId) && p.stats.appearances >= 5)
      .map((p) => ({ p, v: p.stats.ratingSum / p.stats.appearances }))
      .sort((a, b) => b.v - a.v)
      .slice(0, 12)
      .map(({ p, v }) => ({ p, v: v.toFixed(2), club: this.clubs().get(p.clubId!)! })),
  );

  protected isUser(f: Fixture): boolean {
    const id = this.state().userClubId;
    return f.homeId === id || f.awayId === id;
  }

  /** Texte d'un fait de match (rédigé ici pour les matchs des autres clubs, stockés sans texte). */
  protected eventText(e: MatchEvent, f: Fixture): string {
    if (e.text) return e.text;
    const players = this.store.playersById();
    const name = (id?: string) => {
      const p = id ? players.get(id) : undefined;
      return p ? `${p.firstName[0]}. ${p.lastName}` : 'un joueur';
    };
    const club = this.clubs().get(e.side === 'home' ? f.homeId : f.awayId)?.shortName ?? '';
    if (e.type === 'goal') return `But de ${name(e.playerId)}${e.assistId ? ` (passe de ${name(e.assistId)})` : ''} — ${club}`;
    if (e.type === 'red') return `Expulsion de ${name(e.playerId)} — ${club}`;
    return '';
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
      .players.filter((p) => p.clubId && this.leagueClubIds().has(p.clubId) && metric(p) > 0)
      .sort((a, b) => metric(b) - metric(a) || a.stats.appearances - b.stats.appearances)
      .slice(0, 12)
      .map((p) => ({ p, v: metric(p), club: this.clubs().get(p.clubId!)! }));
  }
}
