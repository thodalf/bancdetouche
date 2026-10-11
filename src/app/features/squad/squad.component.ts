import { ChangeDetectionStrategy, Component, computed, inject, signal, effect, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MORALE_LABELS, moraleLevel, moraleReason } from '../../core/engine/morale';
import { isHomegrown } from '../../core/engine/rules';
import { severanceFor } from '../../core/engine/transfers';
import { marketValue } from '../../core/engine/valuation';
import { isNonEu, Player, POSITION_GROUP, POSITION_ORDER, PositionGroup, SQUAD_STATUS_LABELS, SQUAD_STATUS_ORDER } from '../../core/models';
import { GameStore } from '../../core/services/game-store.service';
import { TransferService } from '../../core/services/transfer.service';
import { MeterComponent, RatingComponent } from '../../shared/components/rating.component';
import { ContractDialogComponent } from '../contracts/contract-dialog.component';
import { PotentialStarsComponent } from '../../shared/components/potential-stars.component';
import { FlagPipe, PlayerNamePipe, PositionPipe } from '../../shared/pipes/labels.pipe';
import { MoneyPipe } from '../../shared/pipes/money.pipe';

type SortKey = 'position' | 'name' | 'age' | 'rating' | 'potential' | 'value' | 'wage' | 'form' | 'fatigue' | 'morale' | 'status' | 'apps' | 'goals' | 'avg';
type Filter = PositionGroup | 'ALL' | 'INJ';

interface Row {
  player: Player;
  value: number;
  avg: number | null;
  starter: boolean;
  homegrown: boolean;
}

import { PlayerLinkComponent } from '../../shared/components/player-link.component';

import { PlayerCardService } from '../../core/services/player-card.service';

@Component({
  selector: 'app-squad',
  imports: [PlayerLinkComponent, RouterLink, RatingComponent, MeterComponent, PotentialStarsComponent, MoneyPipe, PositionPipe, FlagPipe, PlayerNamePipe, ContractDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './squad.component.html',
  styleUrl: './squad.component.scss',
})
export class SquadComponent {
  protected readonly store = inject(GameStore);
  private readonly transfers = inject(TransferService);

  protected readonly groupOf = POSITION_GROUP;
  protected readonly statusLabels = SQUAD_STATUS_LABELS;
  protected readonly moraleLabels = MORALE_LABELS;
  protected readonly moraleLevel = moraleLevel;
  protected readonly moraleReason = moraleReason;
  protected readonly isNonEu = isNonEu;
  protected readonly groups: { id: Filter; label: string }[] = [
    { id: 'ALL', label: 'Tous' },
    { id: 'GK', label: 'Gardiens' },
    { id: 'DEF', label: 'Défenseurs' },
    { id: 'MID', label: 'Milieux' },
    { id: 'ATT', label: 'Attaquants' },
    { id: 'INJ', label: 'Infirmerie' },
  ];

  protected readonly filter = signal<Filter>('ALL');
  /** Joueur dont on négocie la prolongation. */
  protected readonly negotiating = signal<string | null>(null);
  protected readonly sortKey = signal<SortKey>('position');
  protected readonly sortDesc = signal(false);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly confirm = signal<'release' | null>(null);

  private readonly rows = computed<Row[]>(() => {
    const club = this.store.userClub();
    const lineup = new Set(club?.tactic.lineup ?? []);
    return this.store.userSquad().map((p) => ({
      player: p,
      value: marketValue(p),
      avg: p.stats.appearances ? p.stats.ratingSum / p.stats.appearances : null,
      starter: lineup.has(p.id),
      homegrown: !!club && isHomegrown(p, club.id),
    }));
  });

  protected readonly visible = computed(() => {
    const f = this.filter();
    const key = this.sortKey();
    const dir = this.sortDesc() ? -1 : 1;
    const val = (r: Row): number | string => {
      const p = r.player;
      switch (key) {
        case 'position':
          return POSITION_ORDER.indexOf(p.position) * 100 - p.rating;
        case 'name':
          return p.lastName;
        case 'value':
          return r.value;
        case 'apps':
          return p.stats.appearances;
        case 'goals':
          return p.stats.goals;
        case 'avg':
          return r.avg ?? 0;
        case 'potential':
          // Tri sur l'avis des recruteurs, jamais sur la valeur cachée.
          return this.store.potentialOf(p)?.stars ?? 0;
        case 'status':
          return SQUAD_STATUS_ORDER.indexOf(p.squadStatus);
        default:
          return p[key];
      }
    };
    return this.rows()
      .filter((r) => f === 'ALL' || (f === 'INJ' ? r.player.injuryWeeks > 0 || r.player.fatigue >= 50 : POSITION_GROUP[r.player.position] === f))
      .sort((a, b) => {
        const x = val(a);
        const y = val(b);
        return (typeof x === 'string' ? x.localeCompare(y as string) : x - (y as number)) * dir;
      });
  });

  protected readonly selected = computed(() => this.rows().find((r) => r.player.id === this.selectedId()) ?? null);
  protected readonly totals = computed(() => {
    const rows = this.rows();
    return {
      count: rows.length,
      value: rows.reduce((s, r) => s + r.value, 0),
      avgAge: rows.length ? rows.reduce((s, r) => s + r.player.age, 0) / rows.length : 0,
    };
  });

  protected sortBy(key: SortKey): void {
    if (this.sortKey() === key) this.sortDesc.update((d) => !d);
    else {
      this.sortKey.set(key);
      this.sortDesc.set(!['position', 'name', 'fatigue', 'status'].includes(key));
    }
  }

  constructor() {
    // « Ouvrir dans l'effectif » depuis la fiche joueur.
    const card = inject(PlayerCardService);
    effect(() => {
      const id = card.squadFocus();
      if (!id) return;
      untracked(() => {
        card.squadFocus.set(null);
        this.filter.set('ALL');
        this.selectedId.set(id);
      });
    });
  }

  protected select(id: string): void {
    this.selectedId.update((cur) => (cur === id ? null : id));
    this.confirm.set(null);
  }

  protected toggleListed(p: Player): void {
    this.transfers.toggleListed(p.id);
  }

  protected severance(p: Player): number {
    return severanceFor(p);
  }

  protected doConfirm(p: Player): void {
    const action = this.confirm();
    if (action !== 'release') return;
    const outcome = this.transfers.release(p.id);
    this.confirm.set(null);
    if (outcome.ok) this.selectedId.set(null);
  }
}
