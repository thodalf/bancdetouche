import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Club } from '../../core/models';

/** Écusson généré à partir des couleurs et du sigle du club. */
@Component({
  selector: 'app-club-crest',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg [attr.width]="size()" [attr.height]="size() * 1.15" viewBox="0 0 40 46" role="img" [attr.aria-label]="club().name">
      <path d="M20 1 L38 6 V22 C38 34 30 41 20 45 C10 41 2 34 2 22 V6 Z" [attr.fill]="club().colors.primary" stroke="rgba(255,255,255,.35)" stroke-width="1.2" />
      <path d="M20 1 L38 6 V22 C38 34 30 41 20 45 Z" [attr.fill]="club().colors.secondary" opacity="0.28" />
      <rect x="2" y="15" width="36" height="10" [attr.fill]="club().colors.secondary" opacity="0.9" />
      <text x="20" y="23.2" text-anchor="middle" font-size="8.5" font-weight="700" [attr.fill]="textColor()" font-family="Barlow Condensed, sans-serif" letter-spacing=".5">
        {{ club().shortName }}
      </text>
    </svg>
  `,
  styles: `:host { display: inline-flex; flex: none; line-height: 0; }`,
})
export class ClubCrestComponent {
  readonly club = input.required<Pick<Club, 'name' | 'shortName' | 'colors'>>();
  readonly size = input(28);

  /** Texte lisible sur la bande secondaire. */
  protected readonly textColor = computed(() => {
    const hex = this.club().colors.secondary.replace('#', '');
    const n = parseInt(hex.length === 3 ? hex.replace(/./g, '$&$&') : hex, 16);
    const luminance = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    return luminance > 0.6 ? '#10231b' : '#ffffff';
  });
}
