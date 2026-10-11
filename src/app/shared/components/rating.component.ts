import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Pastille de note globale, colorée par palier. */
@Component({
  selector: 'app-rating',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="rating" [class]="'rating tier-' + tier()">{{ value() }}</span>`,
})
export class RatingComponent {
  readonly value = input.required<number>();
  protected readonly tier = computed(() => {
    const v = this.value();
    return v >= 82 ? 5 : v >= 76 ? 4 : v >= 70 ? 3 : v >= 63 ? 2 : 1;
  });
}

/** Petite jauge horizontale 0-100 (fatigue, moral, forme). */
@Component({
  selector: 'app-meter',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="meter" [attr.title]="label() + ' : ' + rounded()" role="meter" [attr.aria-valuenow]="rounded()" aria-valuemin="0" aria-valuemax="100" [attr.aria-label]="label()">
      <span class="meter-fill" [style.width.%]="rounded()" [attr.data-level]="level()"></span>
    </span>
  `,
})
export class MeterComponent {
  readonly value = input.required<number>();
  readonly label = input('');
  /** true quand une valeur haute est mauvaise (fatigue) : la jauge affiche alors la fraîcheur restante. */
  readonly inverted = input(false);
  protected readonly rounded = computed(() => {
    const v = Math.round(Math.max(0, Math.min(100, this.value())));
    return this.inverted() ? 100 - v : v;
  });
  protected readonly level = computed(() => {
    const v = this.rounded();
    return v >= 65 ? 'good' : v >= 40 ? 'mid' : 'bad';
  });
}

/** Série de résultats (V/N/D). */
@Component({
  selector: 'app-form-guide',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (r of results(); track $index) {
      <span class="form-dot" [attr.data-r]="r" [attr.title]="labels[r]">{{ short[r] }}</span>
    } @empty {
      <span class="muted">—</span>
    }
  `,
  styles: `:host { display: inline-flex; gap: 3px; }`,
})
export class FormGuideComponent {
  readonly results = input.required<('W' | 'D' | 'L')[]>();
  protected readonly short = { W: 'V', D: 'N', L: 'D' };
  protected readonly labels = { W: 'Victoire', D: 'Nul', L: 'Défaite' };
}
