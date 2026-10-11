import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CUP_NAMES, leagueDef } from '../../core/data/leagues.data';
import { isAvailable, teamStrength } from '../../core/engine/lineup';
import { Side, startingStamina } from '../../core/engine/match-engine';
import { fixtureWinner } from '../../core/engine/schedule';
import { sideInput } from '../../core/engine/season';
import { GAME_PLANS } from '../../core/engine/game-plans';
import { TeamTalkTone, FORMATION_IDS, FORMATIONS, FormationId, INSTRUCTION_LABELS, INSTRUCTION_OPTIONS, Player, POSITION_GROUP, STYLE_LABELS, STYLE_ORDER, TeamStyle } from '../../core/models';
import { GameStore } from '../../core/services/game-store.service';
import { GameService } from '../../core/services/game.service';
import { ToastService } from '../../core/services/toast.service';
import { HotkeyService } from '../../core/services/hotkey.service';
import { LIVE_SPEEDS, LiveMatchService } from '../../core/services/live-match.service';
import { TacticsService } from '../../core/services/tactics.service';
import { ClubCrestComponent } from '../../shared/components/club-crest.component';
import { RatingComponent } from '../../shared/components/rating.component';
import { ScoutedRatingComponent } from '../../shared/components/scouted-rating.component';
import { PlayerNamePipe, PositionPipe } from '../../shared/pipes/labels.pipe';
import { MatchPitchComponent, PitchTeam } from './match-pitch.component';

type Phase = 'pre' | 'live' | 'done' | 'summary';

import { PlayerLinkComponent } from '../../shared/components/player-link.component';

@Component({
  selector: 'app-match',
  imports: [PlayerLinkComponent, RouterLink, ClubCrestComponent, RatingComponent, ScoutedRatingComponent, MatchPitchComponent, PositionPipe, PlayerNamePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './match.component.html',
  styleUrl: './match.component.scss',
})
export class MatchComponent {
  protected readonly store = inject(GameStore);
  protected readonly live = inject(LiveMatchService);
  protected readonly tactics = inject(TacticsService);
  private readonly game = inject(GameService);
  private readonly toast = inject(ToastService);

  protected readonly speeds = LIVE_SPEEDS;
  protected readonly styles = STYLE_ORDER.map((id) => [id, STYLE_LABELS[id]] as const);
  protected readonly styleLabels = STYLE_LABELS;
  protected readonly plans = GAME_PLANS;
  protected readonly allPlans = Object.values(GAME_PLANS);
  protected readonly sidesOrder = ['home', 'away'] as const;
  protected readonly instructionRows = (Object.keys(INSTRUCTION_OPTIONS) as (keyof typeof INSTRUCTION_OPTIONS)[]).map((key) => ({
    key,
    label: INSTRUCTION_LABELS[key],
    options: INSTRUCTION_OPTIONS[key],
  }));
  protected readonly formations = FORMATION_IDS;
  protected readonly talkTones: { id: TeamTalkTone; label: string; hint: string }[] = [
    { id: 'calm', label: 'Rester calme', hint: 'Rassure une équipe qui mène et lui rend un peu d’énergie.' },
    { id: 'encourage', label: 'Encourager', hint: 'Sûr dans un match serré : confiance et envie.' },
    { id: 'angry', label: 'Pousser un coup de gueule', hint: 'Réveille une équipe menée… mais crispe une équipe qui gagne.' },
    { id: 'focus', label: 'Revenir au plan de jeu', hint: 'Effet modéré et régulier, quel que soit le score.' },
  ];
  protected readonly groupOf = POSITION_GROUP;

  protected readonly phase = computed<Phase>(() => {
    const p = this.live.phase();
    return p === 'idle' ? 'pre' : p;
  });
  protected readonly snapshot = this.live.snapshot;
  private readonly pitchRef = viewChild(MatchPitchComponent);
  /** Joueur sélectionné pour sortir. */
  protected readonly subOut = signal<string | null>(null);
  /** Fenêtre des changements ouverte (le match est en pause). */
  protected readonly subsOpen = signal(false);
  private resumeAfterSubs = false;
  protected readonly condition = startingStamina;

  /** Buts annoncés par le moteur mais pas encore marqués sur le terrain 2D. */
  private readonly pending = computed<Record<Side, number>>(() =>
    this.phase() === 'live' ? (this.pitchRef()?.pendingGoals() ?? { home: 0, away: 0 }) : { home: 0, away: 0 },
  );
  /** Score affiché : il change quand le ballon franchit la ligne, pas avant. */
  protected readonly shownScore = computed(() => {
    const s = this.snapshot();
    const p = this.pending();
    return s ? { home: s.home - p.home, away: s.away - p.away } : null;
  });

  /** Joueurs de l'utilisateur sur le terrain, du plus fatigué au plus frais. */
  protected readonly tiredest = computed(() => [...(this.snapshot()?.field ?? [])].filter((x) => x.role !== 'GK').sort((a, b) => a.stamina - b.stamina).slice(0, 3));

  protected readonly fixture = computed(() => {
    const s = this.store.state();
    if (!s) return null;
    const id = this.live.summaryFixtureId() ?? s.liveMatch?.fixtureId ?? this.store.userFixtureThisWeek()?.id;
    return id ? (s.fixtures.find((f) => f.id === id) ?? null) : null;
  });

  protected readonly info = computed(() => {
    const f = this.fixture();
    const s = this.store.state();
    if (!f || !s) return null;
    const clubs = this.store.clubsById();
    const week = s.weeks[f.week];
    return {
      home: clubs.get(f.homeId)!,
      away: clubs.get(f.awayId)!,
      userSide: (f.homeId === s.userClubId ? 'home' : 'away') as Side,
      competition: f.competition === 'cup' ? `${CUP_NAMES[f.cup ?? 'FRA'] ?? 'Coupe'} — ${week.label}` : `${leagueDef(clubs.get(f.homeId)?.leagueId).name} — ${week.label}`,
      week,
    };
  });

  /** Compositions annoncées avant le match. */
  protected readonly preview = computed(() => {
    const f = this.fixture();
    const s = this.store.state();
    if (!f || !s || this.phase() !== 'pre') return null;
    const side = (id: string) => {
      const input = sideInput(s, id);
      const byId = new Map(input.squad.map((p) => [p.id, p]));
      const strength = teamStrength(input.tactic, input.squad);
      return {
        formation: input.tactic.formation,
        style: STYLE_LABELS[input.tactic.style],
        players: FORMATIONS[input.tactic.formation].slots.map((slot, i) => ({ role: slot.role, player: byId.get(input.tactic.lineup[i] ?? '') })),
        bench: input.squad
          .filter((p) => !input.tactic.lineup.includes(p.id) && isAvailable(p))
          .sort((a, b) => b.rating - a.rating)
          .slice(0, 9),
        overall: Math.round(strength.overall),
        attack: Math.round(strength.attack),
        defense: Math.round(strength.defense),
      };
    };
    return { home: side(f.homeId), away: side(f.awayId) };
  });

  /** Équipes pour la visualisation 2D : les vrais joueurs sur le terrain et leurs consignes en cours. */
  protected readonly pitch = computed<{ home: PitchTeam; away: PitchTeam } | null>(() => {
    const m = this.info();
    const snap = this.snapshot();
    if (!m) return null;
    return {
      home: { name: m.home.shortName, colors: m.home.colors, view: snap?.pitch.home },
      away: { name: m.away.shortName, colors: m.away.colors, view: snap?.pitch.away },
    };
  });
  protected readonly minuteMs = computed(() => LIVE_SPEEDS[this.live.speed()].ms);
  protected readonly running = computed(() => this.phase() === 'live' && !this.live.paused());

  /**
   * Faits de jeu synchronisés avec le terrain : ceux de la minute en cours n'apparaissent
   * qu'une fois joués à l'écran, et un but seulement quand le ballon est au fond.
   */
  protected readonly feed = computed(() => {
    const s = this.snapshot();
    if (!s) return [];
    const hidden = this.hiddenGoals();
    const caughtUp = this.phase() !== 'live' || (this.pitchRef()?.caughtUp() ?? true);
    return s.events
      .filter((e) => !hidden.has(e))
      .filter((e) => caughtUp || e.minute < s.minute || e.type === 'info' || e.type === 'goal')
      .reverse();
  });

  /** Événements de but pas encore montrés sur le terrain (les derniers de chaque équipe). */
  private readonly hiddenGoals = computed(() => {
    const s = this.snapshot();
    const p = this.pending();
    const hidden = new Set<object>();
    if (!s) return hidden;
    for (const side of ['home', 'away'] as Side[]) {
      if (!p[side]) continue;
      s.events.filter((e) => e.type === 'goal' && e.side === side).slice(-p[side]).forEach((e) => hidden.add(e));
    }
    return hidden;
  });

  protected readonly summary = computed(() => {
    if (this.phase() !== 'summary') return null;
    const f = this.fixture();
    const s = this.store.state();
    if (!f || !s || !f.played) return null;
    const clubs = this.store.clubsById();
    const players = this.store.playersById();
    const others = s.fixtures
      .filter((x) => x.week === f.week && x.id !== f.id)
      .map((x) => ({ f: x, home: clubs.get(x.homeId)!, away: clubs.get(x.awayId)! }));
    const ratings = Object.entries(f.ratings ?? {})
      .map(([id, r]) => ({ player: players.get(id), rating: r }))
      .filter((x): x is { player: Player; rating: number } => !!x.player && x.player.clubId === s.userClubId)
      .sort((a, b) => b.rating - a.rating);
    const motm = Object.entries(f.ratings ?? {}).sort((a, b) => b[1] - a[1])[0];
    const winner = fixtureWinner(f);
    return {
      others,
      ratings,
      motm: motm ? { player: players.get(motm[0]), rating: motm[1] } : null,
      verdict: winner === null ? 'Match nul' : winner === s.userClubId ? 'Victoire' : 'Défaite',
    };
  });

  constructor() {
    // Reprise d'un direct interrompu (changement de page ou rechargement).
    this.live.restore();
    const destroyRef = inject(DestroyRef);
    // Quitter l'écran met le direct en pause : rien n'est perdu.
    destroyRef.onDestroy(() => this.live.pause());

    // « Jouer le match » alors que l'écran affiche encore le résumé du match précédent.
    effect(() => {
      this.game.matchRequests();
      untracked(() => {
        if (this.live.phase() === 'summary') this.live.reset();
      });
    });

    // Le direct attend que l'animation 2D ait joué chaque minute.
    this.live.setAnimationGate(() => this.pitchRef()?.ready() ?? true);
    destroyRef.onDestroy(() => this.live.setAnimationGate(null));

    // Espace : action suivante selon la phase du match.
    const unregister = inject(HotkeyService).register(() => this.next());
    destroyRef.onDestroy(unregister);
  }

  protected start(instant: boolean): void {
    if (this.store.state()?.events.length) {
      this.toast.show('Une décision vous attend : répondez à l’événement en cours.', 'error');
      return;
    }
    const violation = this.store.ruleViolations()[0];
    if (violation) {
      this.toast.show(`Feuille de match non conforme : ${violation.fix}`, 'error');
      return;
    }
    this.live.start(instant);
  }

  protected setStyle(style: TeamStyle): void {
    this.live.command({ kind: 'style', style });
  }

  protected setFormation(formation: FormationId): void {
    this.live.command({ kind: 'formation', formation });
  }

  /** Ouvre la fenêtre des changements : le match se met en pause le temps de décider. */
  protected openSubs(): void {
    this.resumeAfterSubs = !this.live.paused();
    this.live.pause();
    this.subOut.set(null);
    this.subsOpen.set(true);
  }

  protected closeSubs(): void {
    this.subsOpen.set(false);
    this.subOut.set(null);
    if (this.resumeAfterSubs && this.live.paused() && !this.live.halfTimeTalk()) this.live.togglePause();
  }

  protected staminaLevel(v: number): 'good' | 'mid' | 'low' {
    return v >= 75 ? 'good' : v >= 55 ? 'mid' : 'low';
  }

  protected bringOn(inId: string): void {
    const outId = this.subOut();
    if (!outId) return;
    this.live.command({ kind: 'sub', outId, inId });
    this.subOut.set(null);
  }

  protected scorersFor(side: Side): { name: string; minute: number; red?: boolean }[] {
    const snap = this.snapshot();
    if (!snap) return [];
    const players = this.store.playersById();
    const live = this.store.state()?.liveMatch;
    const squads = live ? [...live.home.squad, ...live.away.squad] : [];
    const hidden = this.hiddenGoals();
    return snap.events
      .filter((e) => e.side === side && (e.type === 'goal' || e.type === 'red') && !hidden.has(e))
      .map((e) => {
        const p = e.playerId ? (players.get(e.playerId) ?? squads.find((x) => x.id === e.playerId)) : undefined;
        return { name: p ? p.lastName : '?', minute: e.minute, red: e.type === 'red' };
      });
  }

  /** Touche Espace sur l'écran de match. */
  private next(): boolean {
    switch (this.phase()) {
      case 'pre':
        if (!this.info()) return false;
        this.start(false);
        return true;
      case 'live':
        this.live.skipToEnd();
        return true;
      case 'done':
        this.live.finish();
        return true;
      default:
        return false; // résumé : on laisse avancer la semaine
    }
  }
}
