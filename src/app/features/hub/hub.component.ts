import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { fixtureWinner } from '../../core/engine/schedule';
import { cupWinner } from '../../core/engine/season';
import { Club, Fixture, NewsKind } from '../../core/models';
import { GameStore } from '../../core/services/game-store.service';
import { GameService } from '../../core/services/game.service';
import { ClubCrestComponent } from '../../shared/components/club-crest.component';
import { FormGuideComponent, MeterComponent } from '../../shared/components/rating.component';
import { MatchDatePipe } from '../../shared/pipes/labels.pipe';
import { MoneyPipe } from '../../shared/pipes/money.pipe';

import { PlayerLinkComponent } from '../../shared/components/player-link.component';

import { WeekService } from '../../core/services/week.service';

@Component({
  selector: 'app-hub',
  imports: [PlayerLinkComponent, RouterLink, ClubCrestComponent, FormGuideComponent, MeterComponent, MoneyPipe, MatchDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './hub.component.html',
  styleUrl: './hub.component.scss',
})
export class HubComponent {
  protected readonly week = inject(WeekService);
  protected readonly store = inject(GameStore);
  protected readonly game = inject(GameService);
  protected readonly leagueName = computed(() => this.store.userLeague().name);
  protected readonly cupName = this.store.userCupName;

  protected readonly kindLabels: Record<NewsKind, string> = {
    board: 'Direction',
    transfer: 'Transferts',
    match: 'Match',
    finance: 'Finances',
    injury: 'Infirmerie',
    season: 'Saison',
    youth: 'Formation',
    scouting: 'Scouting',
    career: 'Carrière',
    squad: 'Vestiaire',
    booster: 'Boosters',
    staff: 'Staff',
    event: 'Événement',
  };

  protected readonly club = computed(() => this.store.userClub()!);
  protected readonly state = computed(() => this.store.state()!);

  protected readonly next = computed(() => {
    const f = this.store.nextUserFixture();
    if (!f) return null;
    const s = this.state();
    const home = f.homeId === s.userClubId;
    const opponent = this.store.clubsById().get(home ? f.awayId : f.homeId)!;
    const table = this.store.standings();
    const oppRow = table.find((r) => r.clubId === opponent.id);
    return {
      fixture: f,
      week: s.weeks[f.week],
      home,
      opponent,
      oppPosition: table.findIndex((r) => r.clubId === opponent.id) + 1,
      oppForm: oppRow?.form ?? [],
      isThisWeek: f.week === s.currentWeek,
    };
  });

  /** Extrait du classement autour du club de l'utilisateur. */
  protected readonly miniTable = computed(() => {
    const table = this.store.standings();
    const idx = table.findIndex((r) => r.clubId === this.state().userClubId);
    const start = Math.max(0, Math.min(idx - 2, table.length - 5));
    return table.slice(start, start + 5).map((row, i) => ({ row, pos: start + i + 1, club: this.store.clubsById().get(row.clubId)! }));
  });

  protected readonly recent = computed(() =>
    this.store
      .userFixtures()
      .filter((f) => f.played)
      .slice(-5)
      .reverse()
      .map((f) => this.describe(f)),
  );

  protected readonly squadAlerts = computed(() => {
    const squad = this.store.userSquad();
    return {
      injured: squad.filter((p) => p.injuryWeeks > 0),
      tired: squad.filter((p) => p.fatigue >= 55 && p.injuryWeeks === 0),
      listed: squad.filter((p) => p.transferListed).length,
    };
  });

  protected readonly topScorers = computed(() =>
    [...this.store.userSquad()]
      .filter((p) => p.stats.goals > 0 || p.stats.assists > 0)
      .sort((a, b) => b.stats.goals - a.stats.goals || b.stats.assists - a.stats.assists)
      .slice(0, 5),
  );

  protected readonly wageUsage = computed(() => Math.round((this.store.userWageBill() / this.club().wageBudget) * 100));

  protected readonly newsLimit = signal(8);
  protected readonly news = computed(() => this.state().news.slice(0, this.newsLimit()));
  protected readonly openNews = signal<string | null>(null);

  protected readonly seasonSummary = computed(() => {
    if (!this.store.seasonOver()) return null;
    const s = this.state();
    const clubs = this.store.clubsById();
    const table = this.store.standings();
    const cup = cupWinner(s);
    return {
      champion: clubs.get(table[0].clubId)!,
      cupWinner: cup ? clubs.get(cup)! : null,
      position: this.store.userPosition(),
      target: this.leagueTarget(),
      success: this.store.userPosition() <= this.leagueTarget(),
      row: table.find((r) => r.clubId === s.userClubId)!,
    };
  });

  /** Place visée en championnat par la direction. */
  protected readonly leagueTarget = computed(() => this.state().board.objectives.find((o) => o.kind === 'league')?.target ?? 8);

  protected toggleNews(id: string): void {
    this.openNews.update((cur) => (cur === id ? null : id));
    const item = this.state().news.find((n) => n.id === id);
    if (item && !item.read) this.game.markNewsRead(id);
  }

  private describe(f: Fixture): { fixture: Fixture; opponent: Club; home: boolean; result: 'W' | 'D' | 'L'; score: string } {
    const s = this.state();
    const home = f.homeId === s.userClubId;
    const opponent = this.store.clubsById().get(home ? f.awayId : f.homeId)!;
    const winner = fixtureWinner(f);
    const result = winner === null ? 'D' : winner === s.userClubId ? 'W' : 'L';
    const us = home ? f.homeGoals : f.awayGoals;
    const them = home ? f.awayGoals : f.homeGoals;
    return { fixture: f, opponent, home, result, score: `${us}-${them}` };
  }
}
