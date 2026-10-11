import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { GameStore } from '../../core/services/game-store.service';
import { GameService } from '../../core/services/game.service';
import { ClubService } from '../../core/services/club.service';
import { HotkeyService } from '../../core/services/hotkey.service';
import { BoosterService } from '../../core/services/booster.service';
import { StaffService } from '../../core/services/staff.service';
import { WeekService } from '../../core/services/week.service';
import { ClubCrestComponent } from '../../shared/components/club-crest.component';
import { PlayerCardComponent } from '../player-card/player-card.component';
import { PlayerLinkComponent } from '../../shared/components/player-link.component';
import { MatchDatePipe, PositionPipe } from '../../shared/pipes/labels.pipe';
import { MoneyPipe } from '../../shared/pipes/money.pipe';

interface NavItem {
  path: string;
  label: string;
  icon: string;
  exact?: boolean;
}

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ClubCrestComponent, PlayerCardComponent, PlayerLinkComponent, MoneyPipe, MatchDatePipe, PositionPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown)': 'onKey($event)' },
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.scss',
})
export class ShellComponent {
  protected readonly store = inject(GameStore);
  protected readonly game = inject(GameService);
  protected readonly clubService = inject(ClubService);
  protected readonly boosters = inject(BoosterService);
  protected readonly staff = inject(StaffService);
  protected readonly week = inject(WeekService);
  private readonly hotkeys = inject(HotkeyService);

  /** Offres d'emploi affichées quand l'entraîneur a été limogé. */
  protected readonly rescueOffers = computed(() =>
    this.store.pendingJobOffers().map((o) => ({ offer: o, club: this.store.clubsById().get(o.clubId)! })),
  );

  protected readonly nav: NavItem[] = [
    { path: '/jeu', label: 'Tableau de bord', icon: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z', exact: true },
    { path: '/jeu/semaine', label: 'Semaine', icon: 'M4 5h16v15H4zM4 9h16M8 3v4M16 3v4M8 13h3M8 16h6' },
    { path: '/jeu/effectif', label: 'Effectif', icon: 'M9 7a3 3 0 1 0 0-.01M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M17 11a2.5 2.5 0 1 0 0-.01M16 14.2c2.8.3 5 2.6 5 5.8' },
    { path: '/jeu/tactique', label: 'Tactique', icon: 'M3 4h18v16H3zM12 4v16M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5M3 9h3v6H3M21 9h-3v6h3' },
    { path: '/jeu/transferts', label: 'Transferts', icon: 'M4 8h13l-3-3M20 16H7l3 3' },
    { path: '/jeu/competitions', label: 'Compétitions', icon: 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H4a3 3 0 0 0 4 4M16 6h4a3 3 0 0 1-4 4M12 13v4M8 20h8' },
    { path: '/jeu/staff', label: 'Staff', icon: 'M5 18l-2-10 5 4 4-7 4 7 5-4-2 10zM5 21h14' },
    { path: '/jeu/boosters', label: 'Boosters', icon: 'M5 3h14v18H5zM9 3v4h6V3M8 12l4-3 4 3-4 6z' },
    { path: '/jeu/club', label: 'Club', icon: 'M3 21h18M5 21V9l7-5 7 5v12M9 21v-6h6v6' },
    { path: '/jeu/finances', label: 'Finances', icon: 'M4 19V9M10 19V5M16 19v-7M22 19H2' },
  ];

  /** Libellé du bouton principal selon la situation. */
  protected readonly advanceLabel = computed(() => {
    if (this.store.state()?.liveMatch) return 'Reprendre le match';
    if (this.store.seasonOver()) return 'Bilan de saison';
    return this.store.userFixtureThisWeek() ? 'Jouer le match' : 'Semaine suivante';
  });

  protected readonly weekInfo = computed(() => {
    const s = this.store.state();
    const w = this.store.currentWeek();
    if (!s) return '';
    if (!w) return `Intersaison ${s.season + 1}`;
    // Semaine de coupe sans match pour ce pays (ex. seizièmes réservés à la coupe de France).
    const country = this.store.userLeague().country;
    const cupHere = w.competition !== 'cup' || s.fixtures.some((f) => f.week === w.index && (f.cup ?? 'FRA') === country);
    const label = cupHere ? w.label : 'Trêve (coupes étrangères)';
    return `${label} — semaine ${s.currentWeek + 1}/${s.weeks.length}`;
  });

  /** Espace = « suivant » (l'écran affiché peut proposer sa propre action). */
  protected onKey(event: KeyboardEvent): void {
    if (HotkeyService.shouldIgnore(event)) return;
    event.preventDefault();
    this.hotkeys.next(() => this.game.advance());
  }
}
