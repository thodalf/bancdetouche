import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { PLAYER_TRAITS, playerTraits, SESSION_INFO, SessionType, TALK_INFO, TalkApproach, WEEK_DAYS } from '../../core/models';
import { GameStore } from '../../core/services/game-store.service';
import { WeekService } from '../../core/services/week.service';
import { ClubCrestComponent } from '../../shared/components/club-crest.component';
import { PlayerLinkComponent } from '../../shared/components/player-link.component';
import { MatchDatePipe } from '../../shared/pipes/labels.pipe';

const PRESETS: { id: string; label: string; sessions: SessionType[] }[] = [
  { id: 'balanced', label: 'Équilibré', sessions: ['recovery', 'tactical', 'physical', 'technical', 'setPieces'] },
  { id: 'match', label: 'Spécial match', sessions: ['recovery', 'tactical', 'tactical', 'setPieces', 'tactical'] },
  { id: 'fresh', label: 'Fraîcheur', sessions: ['recovery', 'rest', 'tactical', 'recovery', 'setPieces'] },
  { id: 'build', label: 'Développement', sessions: ['technical', 'physical', 'technical', 'physical', 'recovery'] },
];

@Component({
  selector: 'app-week',
  imports: [ClubCrestComponent, PlayerLinkComponent, MatchDatePipe, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './week.component.html',
  styleUrl: './week.component.scss',
})
export class WeekComponent {
  protected readonly store = inject(GameStore);
  protected readonly week = inject(WeekService);

  protected readonly days = WEEK_DAYS;
  protected readonly sessionTypes = Object.entries(SESSION_INFO).map(([id, info]) => ({ id: id as SessionType, ...info }));
  protected readonly sessionInfo = SESSION_INFO;
  protected readonly presets = PRESETS;
  protected readonly approaches = Object.entries(TALK_INFO).map(([id, info]) => ({ id: id as TalkApproach, ...info }));
  protected readonly talkLabels = TALK_INFO;

  protected readonly talkTarget = signal<string | null>(null);

  protected readonly pct = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;

  /** Effectif trié par moral croissant : ceux qui ont le plus besoin d'un entretien en tête. */
  protected readonly squad = computed(() => {
    const talked = new Set((this.week.plan()?.talks ?? []).map((t) => t.playerId));
    return [...this.store.userSquad()]
      .sort((a, b) => a.morale - b.morale)
      .map((p) => ({ p, talked: talked.has(p.id), traits: playerTraits(p).map((t) => PLAYER_TRAITS[t].label) }));
  });
  protected readonly target = computed(() => this.squad().find((x) => x.p.id === this.talkTarget()) ?? null);
  protected readonly talks = computed(() => {
    const byId = this.store.playersById();
    return (this.week.plan()?.talks ?? []).map((t) => ({ ...t, player: byId.get(t.playerId) }));
  });

  protected readonly presetActive = computed(() => {
    const s = this.week.plan()?.sessions.join();
    return PRESETS.find((p) => p.sessions.join() === s)?.id ?? null;
  });

  protected doTalk(approach: TalkApproach): void {
    const id = this.talkTarget();
    if (!id) return;
    this.week.talk(id, approach);
    this.talkTarget.set(null);
  }

  protected selectSession(day: number, event: Event): void {
    this.week.setSession(day, (event.target as HTMLSelectElement).value as SessionType);
  }
}
