import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { GameService } from '../../core/services/game.service';
import { SaveService } from '../../core/services/save.service';

@Component({
  selector: 'app-home',
  imports: [RouterLink, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
})
export class HomeComponent {
  protected readonly saves = inject(SaveService);
  private readonly game = inject(GameService);

  protected continue(): void {
    this.game.continueSaved();
  }

  protected onImport(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) this.game.importFile(file);
  }

  /** Suppression en deux temps, sans boîte de dialogue native. */
  protected readonly confirmDelete = signal(false);

  protected deleteSave(): void {
    if (!this.confirmDelete()) {
      this.confirmDelete.set(true);
      return;
    }
    this.saves.delete();
    this.confirmDelete.set(false);
  }
}
