import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Player } from '../../core/models';
import { PlayerCardService } from '../../core/services/player-card.service';

/** Nom de joueur cliquable : ouvre la fiche joueur où qu'on soit dans le jeu. */
@Component({
  selector: 'app-player-link',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<button type="button" class="player-link" (click)="open($event)" (pointerdown)="$event.stopPropagation()" [attr.aria-label]="'Fiche de ' + full()">{{ label() }}</button>`,
  styles: `
    :host {
      display: inline;
      min-width: 0;
    }
    .player-link {
      display: inline;
      max-width: 100%;
      padding: 0;
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
      text-decoration: underline;
      text-decoration-color: transparent;
      text-underline-offset: 3px;
      transition: text-decoration-color 0.15s, color 0.15s;
    }
    .player-link:hover,
    .player-link:focus-visible {
      color: var(--amber);
      text-decoration-color: currentColor;
      outline: none;
    }
  `,
})
export class PlayerLinkComponent {
  private readonly card = inject(PlayerCardService);
  readonly player = input.required<Pick<Player, 'id' | 'firstName' | 'lastName'> | null | undefined>();
  readonly short = input(false);

  protected readonly full = computed(() => (this.player() ? `${this.player()!.firstName} ${this.player()!.lastName}` : ''));
  protected readonly label = computed(() => {
    const p = this.player();
    if (!p) return '—';
    return this.short() ? `${p.firstName.charAt(0)}. ${p.lastName}` : `${p.firstName} ${p.lastName}`;
  });

  protected open(event: Event): void {
    event.stopPropagation();
    const p = this.player();
    if (p) this.card.open(p.id);
  }
}
