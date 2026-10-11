import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LEAGUE_NAME } from '../../core/data/clubs.data';
import { wageBill } from '../../core/engine/finance';
import { squadRating } from '../../core/engine/lineup';
import { createNewGame } from '../../core/engine/new-game';
import { squadOf } from '../../core/engine/world';
import { POSITION_GROUP } from '../../core/models';
import { GameService } from '../../core/services/game.service';
import { ClubCrestComponent } from '../../shared/components/club-crest.component';
import { RatingComponent } from '../../shared/components/rating.component';
import { FlagPipe, PlayerNamePipe, PositionPipe } from '../../shared/pipes/labels.pipe';
import { MoneyPipe } from '../../shared/pipes/money.pipe';

@Component({
  selector: 'app-club-select',
  imports: [RouterLink, ClubCrestComponent, RatingComponent, MoneyPipe, PositionPipe, FlagPipe, PlayerNamePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './club-select.component.html',
  styleUrl: './club-select.component.scss',
})
export class ClubSelectComponent {
  private readonly game = inject(GameService);

  protected readonly leagueName = LEAGUE_NAME;
  protected readonly groupOf = POSITION_GROUP;
  protected readonly managerName = signal('');
  /** Le monde est généré une fois pour l'aperçu, puis recréé à l'identique avec la même graine. */
  private readonly seed = signal((Math.random() * 2 ** 32) >>> 0);
  private readonly preview = computed(() => createNewGame('', 'olv', this.seed()));

  protected readonly clubs = computed(() => {
    const world = this.preview();
    const rows = world.clubs.map((club) => {
      const squad = squadOf(world, club.id);
      return {
        club,
        squad,
        rating: squadRating(squad),
        wageBill: wageBill(squad),
        stars: Array.from({ length: 5 }, (_, i) => i < club.level),
      };
    });
    return rows.sort((a, b) => b.club.reputation - a.club.reputation);
  });

  protected readonly selectedId = signal<string>('esv');
  protected readonly selected = computed(() => this.clubs().find((r) => r.club.id === this.selectedId()) ?? this.clubs()[0]);
  protected readonly selectedRank = computed(() => this.clubs().findIndex((r) => r.club.id === this.selectedId()) + 1);
  protected readonly keyPlayers = computed(() => [...this.selected().squad].sort((a, b) => b.rating - a.rating).slice(0, 6));
  protected readonly expectation = computed(() => {
    const rank = this.selectedRank();
    if (rank <= 2) return 'Jouer le titre';
    if (rank <= 5) return 'Finir sur le podium ou tout près';
    if (rank <= 10) return 'Viser la première moitié de tableau';
    return 'Assurer le maintien';
  });

  protected select(id: string): void {
    this.selectedId.set(id);
  }

  protected start(): void {
    this.game.newGame(this.managerName(), this.selectedId(), this.seed());
  }
}
