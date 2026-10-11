import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Player } from '../../core/models';
import { GameStore } from '../../core/services/game-store.service';
import { RatingComponent } from './rating.component';

/**
 * Note d'un joueur vue par l'entraîneur : exacte s'il est bien connu,
 * sinon un intervalle (brouillard de guerre) qui se resserre avec le scouting.
 */
@Component({
  selector: 'app-scouted-rating',
  imports: [RatingComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (view().exact || (mode() === 'potential' && !!view().potential && view().potential!.min === view().potential!.max)) {
      @if (mode() === 'rating') {
        <app-rating [value]="view().min" />
      } @else {
        <span class="muted">{{ view().potential?.min }}</span>
      }
    } @else if (mode() === 'rating') {
      <span class="range" [attr.title]="'Estimation : connaissance ' + knowledge() + ' %'">{{ view().min }}–{{ view().max }}</span>
    } @else {
      <span class="muted" title="Potentiel estimé">{{ view().potential ? view().potential!.min + '–' + view().potential!.max : '?' }}</span>
    }
  `,
  styles: `
    .range {
      display: inline-block;
      min-width: 52px;
      padding: 1px 6px;
      border: 1px dashed var(--chalk-3);
      border-radius: var(--r-sm);
      font-family: var(--font-display);
      font-weight: 600;
      text-align: center;
      color: var(--chalk-2);
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class ScoutedRatingComponent {
  private readonly store = inject(GameStore);
  readonly player = input.required<Player>();
  readonly mode = input<'rating' | 'potential'>('rating');
  protected readonly view = computed(() => this.store.ratingViewOf(this.player()));
  protected readonly knowledge = computed(() => this.store.knowledge(this.player()));
}
