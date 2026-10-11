import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MISSION_DURATIONS, XP } from '../../core/engine/boosters';
import { BOOSTER_LABELS, MISSION_FOCUS_LABELS, MissionFocus, POSITION_GROUP, RARITY_LABELS } from '../../core/models';
import { BoosterService } from '../../core/services/booster.service';
import { GameStore } from '../../core/services/game-store.service';
import { PotentialStarsComponent } from '../../shared/components/potential-stars.component';
import { FlagPipe, PositionPipe } from '../../shared/pipes/labels.pipe';
import { MoneyPipe } from '../../shared/pipes/money.pipe';

import { PlayerLinkComponent } from '../../shared/components/player-link.component';

@Component({
  selector: 'app-boosters',
  imports: [PlayerLinkComponent, RouterLink, MoneyPipe, PositionPipe, FlagPipe, PotentialStarsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './boosters.component.html',
  styleUrl: './boosters.component.scss',
})
export class BoostersComponent {
  protected readonly store = inject(GameStore);
  protected readonly boosters = inject(BoosterService);

  protected readonly tierLabels = BOOSTER_LABELS;
  protected readonly rarityLabels = RARITY_LABELS;
  protected readonly focusLabels = MISSION_FOCUS_LABELS;
  protected readonly focuses = Object.keys(MISSION_FOCUS_LABELS) as MissionFocus[];
  protected readonly durations = MISSION_DURATIONS;
  protected readonly groupOf = POSITION_GROUP;
  protected readonly xpRules = [
    { label: 'Victoire', value: XP.win },
    { label: 'Match nul', value: XP.draw },
    { label: 'But marqué', value: XP.goal },
    { label: 'Match sans encaisser', value: XP.cleanSheet },
    { label: 'Tour de coupe passé', value: XP.cupRound },
    { label: 'Objectif de la direction atteint', value: XP.objective },
    { label: 'Titre de champion', value: XP.league },
  ];

  /** Consigne et durée choisies pour chaque recruteur (par id). */
  private readonly draft = signal<Record<string, { focus: MissionFocus; weeks: number }>>({});

  protected readonly xpPct = computed(() => Math.round((this.boosters.xp() / this.boosters.xpNeeded()) * 100));
  protected readonly wageRoom = computed(() => (this.store.userClub()?.wageBudget ?? 0) - this.store.userWageBill());

  protected readonly scouts = computed(() => {
    const drafts = this.draft();
    return this.boosters.scouts().map(({ scout, mission }) => {
      const d = drafts[scout.id] ?? { focus: 'balanced' as MissionFocus, weeks: 4 };
      return {
        scout,
        mission,
        draft: d,
        preview: mission ? null : this.boosters.preview(scout.id, d.weeks),
        progress: mission ? Math.round(((mission.weeks - mission.weeksLeft) / mission.weeks) * 100) : 0,
      };
    });
  });

  protected readonly cards = computed(() => {
    const pack = this.boosters.pending();
    if (!pack) return [];
    return pack.cards.map((p, i) => ({ player: p, rarity: this.boosters.rarityOf(p.rating), delay: i * 350, fits: p.wage <= this.wageRoom() }));
  });

  protected setFocus(id: string, focus: MissionFocus): void {
    this.draft.update((d) => ({ ...d, [id]: { weeks: d[id]?.weeks ?? 4, focus } }));
  }

  protected setWeeks(id: string, weeks: number): void {
    this.draft.update((d) => ({ ...d, [id]: { focus: d[id]?.focus ?? 'balanced', weeks } }));
  }

  protected send(id: string, focus: MissionFocus, weeks: number): void {
    this.boosters.start(id, focus, weeks);
  }
}
