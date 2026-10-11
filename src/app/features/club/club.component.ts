import { ChangeDetectionStrategy, Component, computed, effect, inject, input, linkedSignal, signal } from '@angular/core';
import { IMPORTANCE_LABELS, STATUS_LABELS } from '../../core/engine/board';
import { FacilityKind, POSITION_GROUP, TRAINING_LABELS, TrainingIntensity } from '../../core/models';
import { ClubService } from '../../core/services/club.service';
import { GameStore } from '../../core/services/game-store.service';
import { ClubCrestComponent } from '../../shared/components/club-crest.component';
import { RatingComponent } from '../../shared/components/rating.component';
import { PotentialStarsComponent } from '../../shared/components/potential-stars.component';
import { FlagPipe, MatchDatePipe, PositionPipe } from '../../shared/pipes/labels.pipe';
import { MoneyPipe } from '../../shared/pipes/money.pipe';

type Tab = 'infrastructures' | 'entrainement' | 'formation' | 'direction' | 'carriere' | 'identite';

import { PlayerLinkComponent } from '../../shared/components/player-link.component';

@Component({
  selector: 'app-club',
  imports: [PlayerLinkComponent, ClubCrestComponent, RatingComponent, PotentialStarsComponent, MoneyPipe, PositionPipe, FlagPipe, MatchDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './club.component.html',
  styleUrl: './club.component.scss',
})
export class ClubComponent {
  protected readonly store = inject(GameStore);
  protected readonly club = inject(ClubService);

  /** Onglet demandé dans l'URL (?onglet=direction). */
  readonly onglet = input<string | undefined>();

  protected readonly tabs: { id: Tab; label: string }[] = [
    { id: 'identite', label: 'Identité' },
    { id: 'infrastructures', label: 'Infrastructures' },
    { id: 'entrainement', label: 'Entraînement' },
    { id: 'formation', label: 'Centre de formation' },
    { id: 'direction', label: 'Direction' },
    { id: 'carriere', label: 'Carrière' },
  ];
  protected readonly tab = signal<Tab>('infrastructures');

  /** Brouillon de la nouvelle identité (aperçu en direct de l'écusson). */
  protected readonly identity = linkedSignal(() => {
    const c = this.userClub();
    return { name: c.name, shortName: c.shortName, stadium: c.stadium, primary: c.colors.primary, secondary: c.colors.secondary };
  });
  protected readonly identityPreview = computed(() => {
    const d = this.identity();
    return { name: d.name || '—', shortName: (d.shortName || '?').toUpperCase().slice(0, 4), colors: { primary: d.primary, secondary: d.secondary } };
  });
  protected readonly identityDirty = computed(() => {
    const c = this.userClub();
    const d = this.identity();
    return d.name !== c.name || d.shortName !== c.shortName || d.stadium !== c.stadium || d.primary !== c.colors.primary || d.secondary !== c.colors.secondary;
  });

  protected editIdentity(key: 'name' | 'shortName' | 'stadium' | 'primary' | 'secondary', event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.identity.update((d) => ({ ...d, [key]: key === 'shortName' ? value.toUpperCase() : value }));
  }

  protected saveIdentity(event: Event): void {
    event.preventDefault();
    this.club.rename(this.identity());
  }
  protected readonly intensities = Object.entries(TRAINING_LABELS) as [TrainingIntensity, string][];
  protected readonly importanceLabels = IMPORTANCE_LABELS;
  protected readonly statusLabels = STATUS_LABELS;
  protected readonly groupOf = POSITION_GROUP;
  protected readonly levels = [1, 2, 3, 4, 5];

  protected readonly userClub = computed(() => this.store.userClub()!);
  protected readonly state = computed(() => this.store.state()!);

  protected readonly youth = computed(() => [...this.store.userYouth()].sort((a, b) => (this.store.potentialOf(b)?.stars ?? 0) - (this.store.potentialOf(a)?.stars ?? 0) || b.rating - a.rating));

  protected readonly reviews = computed(() => [...this.state().board.reviews].reverse().slice(0, 6));

  protected readonly career = computed(() => {
    const clubs = this.store.clubsById();
    return [...this.state().manager.career].reverse().map((c) => ({ ...c, club: clubs.get(c.clubId)! }));
  });

  protected readonly jobOffers = computed(() =>
    this.store.pendingJobOffers().map((o) => ({ offer: o, club: this.store.clubsById().get(o.clubId)! })),
  );

  protected readonly seasons = computed(() => {
    const clubs = this.store.clubsById();
    return [...this.state().history].reverse().map((h) => ({ ...h, club: clubs.get(h.userClubId), champion: clubs.get(h.championId) }));
  });

  constructor() {
    effect(() => {
      const wanted = this.onglet();
      if (wanted && this.tabs.some((t) => t.id === wanted)) this.tab.set(wanted as Tab);
    });
  }

  protected upgrade(kind: FacilityKind): void {
    this.club.upgrade(kind);
  }
}
