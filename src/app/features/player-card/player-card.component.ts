import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, viewChild } from '@angular/core';
import { marketValue } from '../../core/engine/valuation';
import { PLAYER_TRAITS, playerTraits, POSITION_GROUP, Position, SQUAD_STATUS_LABELS } from '../../core/models';
import { GameStore } from '../../core/services/game-store.service';
import { PlayerCardService } from '../../core/services/player-card.service';
import { TransferService } from '../../core/services/transfer.service';
import { ClubCrestComponent } from '../../shared/components/club-crest.component';
import { PotentialStarsComponent } from '../../shared/components/potential-stars.component';
import { ScoutedRatingComponent } from '../../shared/components/scouted-rating.component';
import { FlagPipe, PositionPipe } from '../../shared/pipes/labels.pipe';
import { MoneyPipe } from '../../shared/pipes/money.pipe';

const POSITION_NAMES: Record<Position, string> = {
  GK: 'Gardien',
  CB: 'Défenseur central',
  LB: 'Latéral gauche',
  RB: 'Latéral droit',
  DM: 'Milieu défensif',
  CM: 'Milieu central',
  LM: 'Milieu gauche',
  RM: 'Milieu droit',
  AM: 'Milieu offensif',
  LW: 'Ailier gauche',
  RW: 'Ailier droit',
  ST: 'Avant-centre',
};

/** Fiche joueur modale, ouverte depuis n'importe quel nom de joueur. */
@Component({
  selector: 'app-player-card',
  imports: [ClubCrestComponent, ScoutedRatingComponent, PotentialStarsComponent, FlagPipe, PositionPipe, MoneyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'card.close()' },
  templateUrl: './player-card.component.html',
  styleUrl: './player-card.component.scss',
})
export class PlayerCardComponent {
  protected readonly card = inject(PlayerCardService);
  protected readonly store = inject(GameStore);
  private readonly transfers = inject(TransferService);
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');

  protected readonly positionNames = POSITION_NAMES;
  protected readonly groupOf = POSITION_GROUP;
  protected readonly statusLabels = SQUAD_STATUS_LABELS;

  protected readonly view = computed(() => {
    const p = this.card.player();
    const s = this.store.state();
    if (!p || !s) return null;
    const own = p.clubId === s.userClubId;
    const club = p.clubId ? (this.store.clubsById().get(p.clubId) ?? null) : null;
    const inWorld = this.store.playersById().has(p.id);
    const knowledge = own ? 100 : this.store.knowledge(p);
    const avg = p.stats.appearances ? p.stats.ratingSum / p.stats.appearances : null;
    const recent = p.recentApps.slice(-10);
    return {
      p,
      own,
      club,
      inWorld,
      knowledge,
      scouting: s.scouting.assignments.includes(p.id),
      value: marketValue(p),
      avg,
      recent,
      condition: 100 - p.fatigue,
      // La personnalité se découvre : elle n'est connue que pour vos joueurs ou les joueurs bien observés.
      traits: own || knowledge >= 60 ? playerTraits(p).map((id) => ({ id, ...PLAYER_TRAITS[id] })) : null,
      clauseKnown: own || knowledge >= 50,
      moraleLabel: p.morale >= 75 ? 'Excellent' : p.morale >= 55 ? 'Bon' : p.morale >= 35 ? 'Moyen' : 'Mauvais',
      formLabel: p.form >= 7 ? 'En feu' : p.form >= 5.5 ? 'Bonne' : p.form >= 4 ? 'Correcte' : 'En difficulté',
    };
  });

  constructor() {
    // Le focus passe dans la fenêtre à l'ouverture (accessibilité clavier).
    effect(() => {
      const el = this.dialog()?.nativeElement;
      if (el) queueMicrotask(() => el.focus());
    });
  }

  protected scout(id: string): void {
    this.transfers.scout(id);
  }
}
