import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Player } from '../../core/models';
import { GameStore } from '../../core/services/game-store.service';

/**
 * Potentiel selon les recruteurs : des étoiles (½ à 5) et une fourchette au survol.
 * La précision dépend de la cellule de recrutement et de l'observation du joueur.
 */
@Component({
  selector: 'app-potential',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (estimate(); as e) {
      <span class="stars" [attr.title]="'Estimation des recruteurs : ' + e.min + '–' + e.max + ' (fiabilité ' + e.confidence + ' %)'" [attr.aria-label]="e.stars + ' étoiles sur 5'">
        @for (s of slots(); track $index) {
          <span class="star" [attr.data-fill]="s"></span>
        }
        @if (detailed()) {
          <small class="range">{{ e.min }}–{{ e.max }}</small>
        }
      </span>
    } @else {
      <span class="unknown" title="Pas assez d'informations : faites observer ce joueur">?</span>
    }
  `,
  styles: `
    .stars {
      display: inline-flex;
      align-items: center;
      gap: 1px;
      white-space: nowrap;
    }
    .star {
      width: 11px;
      height: 11px;
      clip-path: polygon(50% 0, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%);
      background: var(--turf-600);
    }
    .star[data-fill='full'] {
      background: var(--amber);
    }
    .star[data-fill='half'] {
      background: linear-gradient(90deg, var(--amber) 50%, var(--turf-600) 50%);
    }
    .range {
      margin-left: 6px;
      color: var(--chalk-3);
      font-variant-numeric: tabular-nums;
    }
    .unknown {
      color: var(--chalk-3);
      font-weight: 600;
    }
  `,
})
export class PotentialStarsComponent {
  private readonly store = inject(GameStore);
  readonly player = input.required<Player>();
  /** Affiche aussi la fourchette chiffrée. */
  readonly detailed = input(false);

  protected readonly estimate = computed(() => this.store.potentialOf(this.player()));
  protected readonly slots = computed(() => {
    const stars = this.estimate()?.stars ?? 0;
    return [1, 2, 3, 4, 5].map((i) => (stars >= i ? 'full' : stars >= i - 0.5 ? 'half' : 'empty'));
  });
}
