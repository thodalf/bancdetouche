import { computed, inject, Injectable, signal } from '@angular/core';
import { applyCommand, createLiveMatch, replayLiveMatch } from '../engine/live-match';
import { MatchAction, MatchSimulation, PitchPlayer, Side } from '../engine/match-engine';
import { completeWeek } from '../engine/season';
import { describeScenario, GAME_PLANS, GamePlanId, recommendPlans } from '../engine/game-plans';
import { FormationId, FormationSlot, LiveCommand, TeamTalkTone, MatchEvent, MatchStats, Player, TeamInstructions, TeamStyle } from '../models';
import { GameStore } from './game-store.service';
import { ToastService } from './toast.service';

export interface PitchSideView {
  players: { id: string; name: string; role: string; x: number; y: number; yellow: boolean }[];
  style: TeamStyle;
  instructions: TeamInstructions;
}

export type LivePhase = 'idle' | 'live' | 'done' | 'summary';

export interface LiveSnapshot {
  minute: number;
  home: number;
  away: number;
  events: MatchEvent[];
  stats: MatchStats;
  style: TeamStyle;
  action: MatchAction;
  /** Actions de la dernière minute, dans l'ordre (animation 2D). */
  actions: MatchAction[];
  /** Joueurs sur le terrain et consignes des deux équipes (animation 2D). */
  pitch: Record<Side, PitchSideView>;
  formations: Record<Side, FormationId>;
  slots: Record<Side, FormationSlot[]>;
  /** Vue de l'équipe de l'utilisateur pour le panneau des changements. */
  field: PitchPlayer[];
  bench: Player[];
  /** Condition physique (0-100) des remplaçants de l'utilisateur. */
  benchStamina: Record<string, number>;
  subsLeft: number;
  instructions: TeamInstructions;
  /** Endurance collective (0-100) de chaque équipe. */
  energy: Record<Side, number>;
  opponentStyle: TeamStyle;
  scenarioText: string;
  recommended: GamePlanId[];
}

/** Vitesses : millisecondes par minute de jeu. */
export const LIVE_SPEEDS = [
  { label: '×1', ms: 650 },
  { label: '×2', ms: 300 },
  { label: '×4', ms: 110 },
];

/** Minutes simulées entre deux sauvegardes de la progression du direct. */
const PERSIST_EVERY = 5;

/**
 * Match en direct, porté par un service racine : il survit aux changements de page.
 * L'état minimal (graine, équipes figées, décisions horodatées, minute) est aussi stocké
 * dans la partie, ce qui permet de reconstruire le match après un rechargement.
 */
@Injectable({ providedIn: 'root' })
export class LiveMatchService {
  private readonly store = inject(GameStore);
  private readonly toast = inject(ToastService);

  readonly phase = signal<LivePhase>('idle');
  readonly speed = signal(0);
  readonly paused = signal(true);
  readonly snapshot = signal<LiveSnapshot | null>(null);
  /** Match dont on affiche le résumé après validation. */
  readonly summaryFixtureId = signal<string | null>(null);

  /** Un match a démarré et n'est pas encore validé. */
  readonly inProgress = computed(() => !!this.store.state()?.liveMatch);
  readonly userSide = computed<Side>(() => this.store.state()?.liveMatch?.userSide ?? 'home');

  private sim: MatchSimulation | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastStep = 0;
  /**
   * L'écran fournit ici l'état de l'animation 2D : le direct n'avance d'une minute
   * que lorsque l'animation a fini de jouer la précédente (continuité parfaite).
   */
  private animationReady: (() => boolean) | null = null;
  /** La mi-temps attend la causerie de l'entraîneur. */
  readonly halfTimeTalk = signal(false);

  setAnimationGate(gate: (() => boolean) | null): void {
    this.animationReady = gate;
  }

  /** À l'arrivée sur l'écran de match : reconstruit le direct s'il existe. */
  restore(): void {
    const live = this.store.state()?.liveMatch;
    if (!live) {
      if (this.phase() === 'live' || this.phase() === 'done') this.reset();
      return;
    }
    if (!this.sim) {
      this.sim = replayLiveMatch(live);
      if (live.instant && !this.sim.finished) this.sim.runToEnd();
      this.paused.set(true);
    }
    this.phase.set(this.sim.finished ? 'done' : 'live');
    this.halfTimeTalk.set(!this.sim.finished && this.sim.minute === 45 && !this.sim.talkDone(live.userSide));
    this.publish();
  }

  start(instant: boolean): void {
    const fixture = this.store.userFixtureThisWeek();
    const s = this.store.state();
    if (!fixture || !s || s.liveMatch) return;
    const live = createLiveMatch(s, fixture, instant);
    this.store.mutate((draft) => (draft.liveMatch = live));
    this.sim = replayLiveMatch(live, 0);
    if (instant) {
      this.sim.runToEnd();
      this.persistMinute();
      this.phase.set('done');
    } else {
      this.phase.set('live');
      this.paused.set(false);
      this.startTimer();
    }
    this.publish();
  }

  setSpeed(index: number): void {
    this.speed.set(index);
    this.paused.set(false);
    this.startTimer();
  }

  /** Causerie de mi-temps, puis reprise du match. */
  teamTalk(tone: TeamTalkTone): void {
    this.command({ kind: 'talk', tone });
    this.halfTimeTalk.set(false);
    this.paused.set(false);
    this.startTimer();
  }

  togglePause(): void {
    if (this.halfTimeTalk()) return;
    if (this.paused()) {
      this.paused.set(false);
      this.startTimer();
    } else {
      this.pause();
    }
  }

  /** Mise en pause (quitter l'écran de match, ouvrir la tactique…). */
  pause(): void {
    this.paused.set(true);
    this.stopTimer();
    if (this.sim && this.phase() === 'live') this.persistMinute();
  }

  skipToEnd(): void {
    if (!this.sim) return;
    this.halfTimeTalk.set(false);
    this.stopTimer();
    this.sim.runToEnd();
    this.persistMinute();
    this.phase.set('done');
    this.publish();
  }

  /** Décision tactique de l'entraîneur, appliquée à la minute en cours et enregistrée pour le rejeu. */
  command(cmd: DistributiveOmit<LiveCommand, 'minute'>): void {
    const sim = this.sim;
    if (!sim || sim.finished) return;
    const full = { ...cmd, minute: sim.minute } as LiveCommand;
    const error = applyCommand(sim, this.userSide(), full);
    if (error) {
      this.toast.show(error, 'error');
      return;
    }
    this.store.mutate((s) => {
      if (!s.liveMatch) return;
      s.liveMatch.commands.push(full);
      s.liveMatch.minute = sim.minute;
    });
    this.publish();
  }

  /** Plan de jeu complet (mentalité + consignes) en un clic. */
  applyPlan(id: GamePlanId): void {
    const p = GAME_PLANS[id];
    this.command({ kind: 'instructions', instructions: p.instructions, style: p.style, label: p.label });
  }

  setInstruction<K extends keyof TeamInstructions>(key: K, value: TeamInstructions[K]): void {
    this.command({ kind: 'instructions', instructions: { [key]: value } as Partial<TeamInstructions> });
  }

  /** Valide le résultat : la semaine se termine et le match en direct est effacé. */
  finish(): void {
    const sim = this.sim;
    const live = this.store.state()?.liveMatch;
    if (!sim || !live || !sim.finished) return;
    const result = sim.result();
    this.store.mutate((s, rng, ids) => {
      completeWeek(s, rng, ids, { fixtureId: live.fixtureId, result });
      s.liveMatch = null;
    });
    this.sim = null;
    this.summaryFixtureId.set(live.fixtureId);
    this.phase.set('summary');
  }

  /** Retour à l'état initial (nouveau match à préparer). */
  reset(): void {
    this.stopTimer();
    this.halfTimeTalk.set(false);
    this.sim = null;
    this.snapshot.set(null);
    this.summaryFixtureId.set(null);
    this.paused.set(true);
    this.phase.set('idle');
  }

  // ------------------------------------------------------------------ interne

  private tick(): void {
    const sim = this.sim;
    if (!sim) return this.stopTimer();
    const now = performance.now();
    if (now - this.lastStep < LIVE_SPEEDS[this.speed()].ms) return;
    // On attend que le terrain ait joué la minute en cours (score, mi-temps et fin synchronisés).
    if (this.animationReady && !this.animationReady()) return;
    if (sim.finished) {
      this.stopTimer();
      this.phase.set('done');
      this.publish();
      return;
    }
    // Mi-temps : le match s'arrête le temps de la causerie.
    if (sim.minute === 45 && !sim.talkDone(this.userSide())) {
      this.halfTimeTalk.set(true);
      this.pause();
      return;
    }
    this.lastStep = now;
    sim.step();
    if (sim.minute % PERSIST_EVERY === 0 || sim.finished) this.persistMinute();
    this.publish();
  }

  private startTimer(): void {
    this.stopTimer();
    if (this.phase() !== 'live' || this.paused()) return;
    this.timer = setInterval(() => this.tick(), 40);
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private persistMinute(): void {
    const minute = this.sim?.minute ?? 0;
    this.store.mutate((s) => s.liveMatch && (s.liveMatch.minute = minute));
  }

  private pitchSide(sim: MatchSimulation, side: Side): PitchSideView {
    const slots = sim.slotsOf(side);
    return {
      players: sim.onField(side).map((x) => ({
        id: x.player.id,
        name: x.player.lastName,
        role: x.role,
        x: slots[x.slot]?.x ?? 50,
        y: slots[x.slot]?.y ?? 50,
        yellow: x.yellow,
      })),
      style: sim.styleOf(side),
      instructions: { ...sim.instructionsOf(side) },
    };
  }

  private publish(): void {
    const sim = this.sim;
    if (!sim) return;
    const side = this.userSide();
    this.snapshot.set({
      minute: sim.minute,
      home: sim.homeGoals,
      away: sim.awayGoals,
      events: [...sim.events],
      stats: sim.stats,
      style: sim.styleOf(side),
      action: { ...sim.lastAction },
      actions: sim.minuteActions.map((a) => ({ ...a })),
      pitch: { home: this.pitchSide(sim, 'home'), away: this.pitchSide(sim, 'away') },
      formations: { home: sim.formationOf('home'), away: sim.formationOf('away') },
      slots: { home: sim.slotsOf('home'), away: sim.slotsOf('away') },
      field: sim.onField(side),
      bench: sim.benchOf(side),
      benchStamina: Object.fromEntries(sim.benchOf(side).map((p) => [p.id, sim.staminaOf(side, p.id)])),
      subsLeft: sim.subsLeft(side),
      instructions: { ...sim.instructionsOf(side) },
      energy: { home: sim.energyOf('home'), away: sim.energyOf('away') },
      opponentStyle: sim.styleOf(side === 'home' ? 'away' : 'home'),
      scenarioText: describeScenario(sim.scenario(side)),
      recommended: recommendPlans(sim.scenario(side)),
    });
  }
}

/** Omit appliqué à chaque membre d'une union. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
