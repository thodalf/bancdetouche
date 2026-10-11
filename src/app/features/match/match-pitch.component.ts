import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { MatchAction } from '../../core/engine/match-engine';
import { ClubColors, DEFAULT_INSTRUCTIONS, TeamInstructions, TeamStyle } from '../../core/models';
import { PitchSideView } from '../../core/services/live-match.service';

type Side = 'home' | 'away';

export interface PitchTeam {
  name: string;
  colors: ClubColors;
  /** Joueurs réellement sur le terrain, positions de leurs postes et consignes en cours. */
  view?: PitchSideView;
}

// Terrain en mètres : l'équipe à domicile attaque vers x = 105.
const L = 105;
const W = 68;
const GOAL_HALF = 3.66;
const GRAVITY = 9.8;
const ROLL_DECEL = 3.6;

interface Vec {
  x: number;
  y: number;
}

interface Pl extends Vec {
  id: string;
  side: Side;
  line: 'GK' | 'DEF' | 'MID' | 'ATT';
  gk: boolean;
  fullback: boolean;
  name: string;
  /** Poste dans la formation (en %, x latéral, y du but adverse vers son propre but). */
  sx: number;
  sy: number;
  vx: number;
  vy: number;
  leaving: boolean;
  yellow: boolean;
  /** Appel de balle demandé par le moteur (zone à atteindre). */
  run: (Vec & { until: number }) | null;
  /** Conduite de balle : point visé par le porteur. */
  dribble: Vec | null;
  /** Ne peut pas toucher le ballon avant cet instant (après une passe, un tacle subi…). */
  noControlUntil: number;
}

interface Ball extends Vec {
  z: number;
  vx: number;
  vy: number;
  vz: number;
  owner: Pl | null;
  last: Pl | null;
  /** Passe en cours : destinataire et point visé. */
  pass: { receiver: Pl; aim: Vec; side: Side; tried: Map<Pl, number> } | null;
  /** Tir en cours et son issue, imposée par le moteur. */
  shot: { side: Side; result: 'goal' | 'save' | 'miss'; keeper: Pl | null; scorer: string } | null;
}

type Directive =
  | { kind: 'attack'; side: Side; playerId?: string; zone?: MatchAction['zone']; counter?: boolean; started: number; ready: boolean; forced?: boolean }
  | { kind: 'shot'; side: Side; playerId?: string; assistId?: string; keeperId?: string; result: 'goal' | 'save' | 'miss'; started: number; ready: boolean; stage: 'build' | 'shooting'; viaDone?: boolean; forced?: boolean; scored?: boolean }
  | { kind: 'foul'; side: Side; offenderId?: string; started: number; ready: boolean };

type Phase = 'play' | 'dead' | 'kickoff' | 'celebrate';

const GROUP: Record<string, Pl['line']> = {
  GK: 'GK', CB: 'DEF', LB: 'DEF', RB: 'DEF', DM: 'MID', CM: 'MID', LM: 'MID', RM: 'MID', AM: 'MID', LW: 'ATT', RW: 'ATT', ST: 'ATT',
};
const STYLE_SHIFT: Record<TeamStyle, number> = { ultraDefensive: -0.06, defensive: -0.03, balanced: 0, attacking: 0.03, ultraAttacking: 0.06 };
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Match en 2D : une petite simulation physique continue (ballon avec vitesse, frottement et gravité,
 * joueurs avec accélération et vitesse de course) qui ne se téléporte jamais.
 * Le moteur du jeu décide de l'issue (attaques, tirs, buts, fautes) ; un « metteur en scène »
 * oriente les décisions des joueurs pour que ces actions se produisent naturellement sur le terrain :
 * le porteur cherche le bon partenaire, l'attaquant fait l'appel, le buteur frappe, le gardien plonge.
 * Tout le reste (circulation, pressing, tacles, interceptions, touches) est joué librement.
 */
@Component({
  selector: 'app-match-pitch',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<canvas #canvas role="img" [attr.aria-label]="'Animation du match ' + home().name + ' contre ' + away().name"></canvas>`,
  styles: `
    :host {
      display: block;
      width: 100%;
      max-width: 860px;
      margin: 0 auto;
    }
    canvas {
      display: block;
      width: 100%;
      border-radius: var(--r-md);
    }
  `,
})
export class MatchPitchComponent {
  readonly home = input.required<PitchTeam>();
  readonly away = input.required<PitchTeam>();
  /** Actions de la dernière minute simulée par le moteur. */
  readonly actions = input<MatchAction[]>([]);
  /** Durée réelle d'une minute de jeu (ms) : fixe la vitesse de lecture. */
  readonly minuteMs = input(650);
  /** Le direct avance (sinon, tout est figé). */
  readonly running = input(true);

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  /**
   * Buts annoncés par le moteur mais pas encore marqués à l'écran : le tableau d'affichage
   * les retranche, pour que le score change au moment où le ballon franchit la ligne.
   */
  readonly pendingGoals = signal<Record<Side, number>>({ home: 0, away: 0 });
  /** Le terrain a joué toutes les actions reçues (les faits de jeu de la minute peuvent s'afficher). */
  readonly caughtUp = signal(true);

  private players: Pl[] = [];
  private ball: Ball = { x: L / 2, y: W / 2, z: 0, vx: 0, vy: 0, vz: 0, owner: null, last: null, pass: null, shot: null };
  private directives: Directive[] = [];
  private lastSeq = 0;
  /** Temps du monde (s). */
  private t = 0;
  private phase: Phase = 'kickoff';
  private phaseUntil = 1.5;
  private kickoffSide: Side = 'home';
  private dead: { taker: Pl; at: Vec } | null = null;
  private nextThink = 0;
  /** Une équipe doit récupérer le ballon (le moteur lui donne une action) : son pressing devient décisif. */
  private wantSide: Side | null = null;
  private wantSince = 0;
  private lastActionAt = 0;
  private celebration: { side: Side; scorer: string; until: number; start: number; scorerPl: Pl | null } | null = null;
  private spotlight: { id: string; until: number } | null = null;
  private trail: Vec[] = [];
  private lastFrame = 0;
  private frame = 0;
  private width = 0;
  private height = 0;
  private pitchCache: HTMLCanvasElement | null = null;
  private readonly reducedMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor() {
    const destroyRef = inject(DestroyRef);

    effect(() => {
      const home = this.home().view;
      const away = this.away().view;
      untracked(() => this.sync(home, away));
    });

    effect(() => {
      const actions = this.actions();
      untracked(() => this.receive(actions));
    });

    afterNextRender(() => {
      const el = this.canvas().nativeElement;
      const observer = new ResizeObserver(() => this.resize());
      observer.observe(el.parentElement ?? el);
      this.resize();
      const loop = (now: number) => {
        const raw = this.lastFrame ? Math.min(0.05, (now - this.lastFrame) / 1000) : 0.016;
        this.lastFrame = now;
        if (this.running()) {
          // Vitesse du direct = cadence du monde ; on découpe en petits pas pour la stabilité.
          const scale = this.timeScale();
          let remaining = raw * scale;
          while (remaining > 0) {
            const dt = Math.min(1 / 60, remaining);
            this.update(dt);
            remaining -= dt;
          }
        }
        this.caughtUp.set(this.ready());
        this.draw(now);
        this.frame = requestAnimationFrame(loop);
      };
      this.frame = requestAnimationFrame(loop);
      destroyRef.onDestroy(() => {
        cancelAnimationFrame(this.frame);
        observer.disconnect();
      });
    });
  }

  /** Le moteur peut jouer la minute suivante : les actions demandées ont toutes eu lieu sur le terrain. */
  ready(): boolean {
    return !this.directives.length && this.phase !== 'celebrate' && this.phase !== 'kickoff' && this.t - this.lastActionAt >= 0.5;
  }

  private timeScale(): number {
    const ms = this.minuteMs();
    const base = ms >= 600 ? 2.2 : ms >= 250 ? 3.8 : 7;
    return base * (this.directives.length > 2 ? 1.4 : 1);
  }

  // ------------------------------------------------------------------ équipes

  private teamView(side: Side): { style: TeamStyle; i: TeamInstructions } {
    const v = (side === 'home' ? this.home() : this.away()).view;
    return { style: v?.style ?? 'balanced', i: { ...DEFAULT_INSTRUCTIONS, ...(v?.instructions ?? {}) } };
  }

  private sync(home?: PitchSideView, away?: PitchSideView): void {
    const first = !this.players.length;
    const next: Pl[] = [];
    for (const [side, view] of [['home', home], ['away', away]] as const) {
      for (const v of view?.players ?? []) {
        const line = GROUP[v.role] ?? 'MID';
        const props = { sx: v.x, sy: v.y, line, gk: line === 'GK', fullback: v.role === 'LB' || v.role === 'RB', name: v.name, yellow: v.yellow };
        const existing = this.players.find((p) => p.id === v.id && !p.leaving);
        if (existing) {
          Object.assign(existing, props);
          next.push(existing);
          continue;
        }
        const p: Pl = { id: v.id, side, ...props, x: L / 2 + (side === 'home' ? -4 : 4), y: W + 1.5, vx: 0, vy: 0, leaving: false, run: null, dribble: null, noControlUntil: 0 };
        if (first) Object.assign(p, this.kickoffSpot(p, 'home'));
        next.push(p);
      }
    }
    // Remplacés et expulsés quittent le terrain en marchant.
    for (const p of this.players) {
      if (next.includes(p)) continue;
      p.leaving = true;
      if (this.ball.owner === p) this.looseBall(p, 2);
      next.push(p);
    }
    this.players = next;
    if (first && this.players.length) this.setupKickoff('home', 1.2);
  }

  private active(side?: Side): Pl[] {
    return this.players.filter((p) => !p.leaving && (!side || p.side === side));
  }

  private byId(id: string | undefined): Pl | null {
    return (id && this.players.find((p) => p.id === id && !p.leaving)) || null;
  }

  private keeper(side: Side): Pl | null {
    return this.players.find((p) => p.side === side && p.gk && !p.leaving) ?? null;
  }

  private nearest(side: Side, at: Vec, withGk = false, exclude?: Pl | null): Pl | null {
    let best: Pl | null = null;
    let d = Infinity;
    for (const p of this.active(side)) {
      if ((p.gk && !withGk) || p === exclude) continue;
      const k = dist(p, at);
      if (k < d) {
        d = k;
        best = p;
      }
    }
    return best;
  }

  /** Profondeur dans le repère de l'équipe : 0 = son but, 1 = but adverse. */
  private depth(side: Side, x: number): number {
    return side === 'home' ? x / L : 1 - x / L;
  }

  private toPitch(side: Side, depth: number, lat: number): Vec {
    return side === 'home' ? { x: depth * L, y: lat * W } : { x: (1 - depth) * L, y: (1 - lat) * W };
  }

  private attackGoal(side: Side): Vec {
    return { x: side === 'home' ? L : 0, y: W / 2 };
  }

  private kickoffSpot(p: Pl, kicking: Side): Vec {
    let depth = 0.04 + (1 - p.sy / 100) * 0.4;
    if (!p.gk) depth = Math.min(depth, p.side === kicking ? 0.48 : 0.4);
    return this.toPitch(p.side, depth, p.sx / 100);
  }

  /**
   * Place d'un joueur sans ballon, selon son poste et les consignes de son équipe :
   * mentalité, ligne, largeur, pressing, couloir d'attaque, phase de jeu, hors-jeu.
   */
  private shape(p: Pl): Vec {
    const { style, i } = this.teamView(p.side);
    const own = this.ball.owner ? this.ball.owner.side === p.side : this.ball.pass?.side === p.side;
    const bd = this.depth(p.side, this.ball.x);
    const bl = p.side === 'home' ? this.ball.y / W : 1 - this.ball.y / W;
    let depth = 0.04 + (1 - p.sy / 100) * 0.42;
    let lat = p.sx / 100;
    if (p.gk) {
      const sweeper = i.line === 'high' ? 0.035 : i.line === 'deep' ? 0.005 : 0.02;
      depth = clamp(0.015 + sweeper + Math.max(0, bd - 0.5) * 0.08, 0.01, 0.12);
      lat = 0.5 + (bl - 0.5) * 0.22;
      return this.toPitch(p.side, depth, lat);
    }
    depth += STYLE_SHIFT[style];
    const lineShift = i.line === 'high' ? 0.07 : i.line === 'deep' ? -0.05 : 0;
    depth += p.line === 'DEF' ? lineShift : p.line === 'MID' ? lineShift * 0.5 : lineShift * 0.25;
    depth += (bd - 0.5) * (own ? 0.62 : 0.5);
    if (own) {
      depth += 0.06 + (p.fullback ? (i.width === 'wide' ? 0.08 : 0.04) : 0) + (p.line === 'ATT' && i.passing === 'direct' ? 0.04 : 0);
      if (p.line === 'ATT') depth = Math.max(depth, bd + 0.06);
      if (p.line === 'MID') depth = Math.max(depth, bd - 0.16);
      if (p.line === 'DEF') depth = Math.max(depth, bd - 0.48);
      // Hors-jeu : pas plus loin que le dernier défenseur adverse.
      depth = Math.min(depth, Math.max(1 - this.backLine(p.side === 'home' ? 'away' : 'home') + 0.004, bd));
    } else {
      const press = i.pressing === 'high' ? 0.07 : i.pressing === 'low' ? -0.06 : 0;
      depth += (p.line === 'DEF' ? press * 0.4 : press) - 0.03;
      if (p.line === 'DEF') depth = Math.min(depth, bd - 0.04);
      if (p.line === 'MID') depth = Math.min(depth, bd + 0.06);
      if (p.line === 'ATT') depth = Math.max(depth, Math.max(0.36, Math.min(0.5, bd + 0.2)));
    }
    const width = i.width === 'wide' ? 1.15 : i.width === 'narrow' ? 0.78 : 1;
    lat = 0.5 + (lat - 0.5) * width * (own ? 1.05 : 0.8);
    lat += (bl - 0.5) * (own ? 0.12 : 0.3);
    if (own && i.focus === 'flanks' && p.line === 'ATT') lat = 0.5 + (lat - 0.5) * 1.25;
    if (own && i.focus === 'center' && p.line === 'ATT') lat = 0.5 + (lat - 0.5) * 0.7;
    return this.toPitch(p.side, clamp(depth, 0.06, 0.95), clamp(lat, 0.04, 0.96));
  }

  private backLine(side: Side): number {
    const depths = this.active(side).filter((p) => !p.gk).map((p) => this.depth(side, p.x));
    return depths.length ? Math.min(...depths) : 0.2;
  }

  // ------------------------------------------------------------------ actions du moteur → consignes de mise en scène

  private receive(actions: MatchAction[]): void {
    const fresh = actions.filter((a) => a.seq > this.lastSeq);
    if (!fresh.length) return;
    this.lastSeq = fresh[fresh.length - 1].seq;
    this.lastActionAt = this.t;
    for (let k = 0; k < fresh.length; k++) {
      const a = fresh[k];
      switch (a.kind) {
        case 'possession':
          // Simple tendance : l'équipe qui domine la minute presse plus fort.
          if (!this.directives.length && this.holderSide() !== a.side && Math.random() < 0.5) {
            this.wantSide = a.side;
            this.wantSince = this.t;
          }
          break;
        case 'attack':
          this.directives.push({ kind: 'attack', side: a.side, playerId: a.playerId, zone: a.zone, counter: a.counter, started: -1, ready: false });
          break;
        case 'shot': {
          const res = fresh[k + 1];
          if (res && (res.kind === 'goal' || res.kind === 'save' || res.kind === 'miss')) {
            this.directives.push({ kind: 'shot', side: a.side, playerId: a.playerId, assistId: res.assistId, keeperId: res.keeperId, result: res.kind, started: -1, ready: false, stage: 'build' });
            if (res.kind === 'goal') this.addPending(a.side, 1);
            k++;
          }
          break;
        }
        case 'foul':
          this.directives.push({ kind: 'foul', side: a.side, offenderId: a.playerId, started: -1, ready: false });
          break;
        default:
          break;
      }
    }
  }

  private holderSide(): Side | null {
    return this.ball.owner?.side ?? this.ball.pass?.side ?? null;
  }

  /** Avancement de la consigne en tête de file. */
  private direct(): void {
    const d = this.directives[0];
    if (!d) {
      if (this.wantSide && (this.holderSide() === this.wantSide || this.t - this.wantSince > 6)) this.wantSide = null;
      return;
    }
    if (d.started < 0) d.started = this.t;
    const age = this.t - d.started;
    const owner = this.ball.owner;
    const hasBall = this.holderSide() === d.side;
    const done = () => {
      // Un but jamais montré (garde-fou) est tout de même compté au tableau d'affichage.
      if (d.kind === 'shot' && d.result === 'goal' && !d.scored) this.addPending(d.side, -1);
      this.directives.shift();
      this.wantSide = null;
    };
    // Garde-fou absolu : une consigne ne bloque jamais le match.
    if (age > 20) return done();

    if (!hasBall && this.phase === 'play') {
      // L'équipe concernée doit d'abord récupérer le ballon : pressing décisif.
      this.wantSide = d.side;
      if (this.wantSince < d.started) this.wantSince = this.t;
    } else if (hasBall) {
      this.wantSide = null;
    }

    switch (d.kind) {
      case 'attack': {
        const p = this.byId(d.playerId) ?? this.bestAttacker(d.side);
        if (!p) return done();
        if (!d.ready) {
          d.ready = true;
          p.run = { ...this.zonePoint(d.side, d.zone, rnd(0.64, 0.76)), until: this.t + 14 };
          this.spot(p.id, 3);
        }
        if (owner === p && this.depth(d.side, p.x) >= 0.58) {
          p.run = null;
          return done();
        }
        if (hasBall && owner && owner !== p && owner.side === d.side && age > 5 && !d.forced) {
          d.forced = true;
          this.kick(owner, p.run ?? this.predict(p), p, true);
        }
        if (age > 18 && hasBall) {
          p.run = null;
          return done();
        }
        return;
      }
      case 'shot': {
        const s = this.byId(d.playerId) ?? this.bestAttacker(d.side);
        if (!s) return done();
        if (!d.ready) {
          d.ready = true;
          if (!s.gk) s.run = { ...this.zonePoint(d.side, 'center', rnd(0.8, 0.87), true), until: this.t + 16 };
          this.spot(s.id, 3);
        }
        if (d.stage === 'shooting') {
          if (!this.ball.shot && this.phase !== 'celebrate') return done();
          return;
        }
        if (owner === s && this.phase === 'play') {
          const dg = dist(s, this.attackGoal(d.side));
          if (dg <= 30 || (age > 5 && dg <= 40) || age > 10) {
            s.run = null;
            d.stage = 'shooting';
            this.shoot(s, d.result, this.byId(d.keeperId) ?? this.keeper(d.side === 'home' ? 'away' : 'home'));
          }
          return;
        }
        // Passe décisive : le passeur reçoit d'abord, puis sert le buteur.
        const via = d.assistId && !d.viaDone ? this.byId(d.assistId) : null;
        if (via && owner === via) d.viaDone = true;
        if (hasBall && owner && owner.side === d.side && this.phase === 'play') {
          const holdFor = this.t - this.nextThink;
          if ((age > 4.5 || (d.viaDone && owner === via && holdFor > -0.2)) && !d.forced && owner !== s) {
            d.forced = true;
            this.kick(owner, s.run ?? this.predict(s), s, dist(owner, s) > 26);
          }
        }
        if (age > 12 && owner && owner.side === d.side && owner !== s && this.phase === 'play') {
          // Le buteur n'a jamais été servi : le porteur frappe lui-même (même issue).
          d.stage = 'shooting';
          this.shoot(owner, d.result, this.byId(d.keeperId) ?? this.keeper(d.side === 'home' ? 'away' : 'home'));
        }
        return;
      }
      case 'foul': {
        const offender = this.byId(d.offenderId);
        if (!offender) return done();
        if (owner && owner.side === d.side && this.phase === 'play') {
          if (dist(offender, owner) < 2.2) {
            this.foul(offender, owner);
            return done();
          }
        } else if (age > 10) return done();
        return;
      }
    }
  }

  private bestAttacker(side: Side): Pl | null {
    return this.active(side).filter((p) => p.line === 'ATT').sort((a, b) => this.depth(side, b.x) - this.depth(side, a.x))[0] ?? this.nearest(side, this.attackGoal(side));
  }

  private zonePoint(side: Side, zone: MatchAction['zone'] | undefined, depth: number, central = false): Vec {
    const lat = central ? rnd(0.36, 0.64) : zone === 'left' ? rnd(0.1, 0.22) : zone === 'right' ? rnd(0.78, 0.9) : rnd(0.36, 0.64);
    return this.toPitch(side, depth, lat);
  }

  private spot(id: string, seconds: number): void {
    this.spotlight = { id, until: this.t + seconds };
  }

  /** Directive en cours qui favorise un joueur (pour orienter les choix du porteur). */
  private biasFor(side: Side): { player: Pl | null; point: Vec | null } {
    const d = this.directives[0];
    if (!d || d.side !== side || d.kind === 'foul') return { player: null, point: null };
    if (d.kind === 'shot') {
      const via = d.assistId && !d.viaDone ? this.byId(d.assistId) : null;
      const s = this.byId(d.playerId);
      const target = via && via !== s ? via : s;
      return { player: target, point: target?.run ?? null };
    }
    const p = this.byId(d.playerId);
    return { player: p, point: p?.run ?? null };
  }

  // ------------------------------------------------------------------ ballon

  private predict(p: Pl, ahead = 0.5): Vec {
    return { x: clamp(p.x + p.vx * ahead, 1, L - 1), y: clamp(p.y + p.vy * ahead, 1, W - 1) };
  }

  /** Frappe du ballon vers un point (passe au sol ou aérienne). */
  private kick(from: Pl, aim: Vec, receiver: Pl | null, lofted: boolean): void {
    const d = Math.max(1, dist(from, aim));
    const b = this.ball;
    b.owner = null;
    b.last = from;
    b.x = from.x;
    b.y = from.y;
    const ux = (aim.x - from.x) / d;
    const uy = (aim.y - from.y) / d;
    if (lofted) {
      const T = 0.55 + d / 24;
      b.vz = (GRAVITY * T) / 2;
      b.vx = (ux * d) / T;
      b.vy = (uy * d) / T;
    } else {
      // Vitesse initiale pour arriver encore « vivant » (≈ 4 m/s) au point visé.
      const v0 = Math.min(24, Math.sqrt(16 + 2 * ROLL_DECEL * d));
      b.vz = 0;
      b.vx = ux * v0;
      b.vy = uy * v0;
    }
    b.z = 0;
    b.pass = receiver ? { receiver, aim, side: from.side, tried: new Map() } : null;
    from.noControlUntil = this.t + 0.35;
    from.dribble = null;
  }

  private looseBall(from: Pl, speed: number): void {
    const b = this.ball;
    b.owner = null;
    b.pass = null;
    b.last = from;
    const a = Math.random() * Math.PI * 2;
    b.vx = Math.cos(a) * speed;
    b.vy = Math.sin(a) * speed;
    b.vz = 0;
    from.noControlUntil = this.t + 0.6;
  }

  private shoot(s: Pl, result: 'goal' | 'save' | 'miss', keeper: Pl | null): void {
    const goal = this.attackGoal(s.side);
    let aim: Vec;
    let lob = false;
    if (result === 'goal') {
      // Côté opposé au gardien.
      const kSide = keeper ? Math.sign(keeper.y - W / 2) || 1 : 1;
      aim = { x: goal.x + (s.side === 'home' ? 1.2 : -1.2), y: W / 2 - kSide * rnd(1.6, GOAL_HALF - 0.5) };
    } else if (result === 'save') {
      const ky = keeper ? keeper.y : W / 2;
      aim = { x: goal.x + (s.side === 'home' ? 1 : -1), y: clamp(ky + rnd(-0.8, 0.8), W / 2 - GOAL_HALF + 0.4, W / 2 + GOAL_HALF - 0.4) };
    } else {
      lob = Math.random() < 0.35;
      aim = { x: goal.x + (s.side === 'home' ? 2 : -2), y: lob ? W / 2 + rnd(-2, 2) : W / 2 + (Math.random() < 0.5 ? -1 : 1) * rnd(GOAL_HALF + 0.6, GOAL_HALF + 4) };
    }
    const b = this.ball;
    const d = Math.max(1, dist(s, aim));
    b.owner = null;
    b.last = s;
    const speed = rnd(22, 28);
    b.vx = ((aim.x - s.x) / d) * speed;
    b.vy = ((aim.y - s.y) / d) * speed;
    const T = d / speed;
    b.vz = lob ? GRAVITY * T * 0.62 : (GRAVITY * T) / 2 * rnd(0.05, 0.35);
    b.pass = null;
    b.shot = { side: s.side, result, keeper, scorer: s.name };
    s.noControlUntil = this.t + 0.6;
    this.spot(s.id, 2.5);
  }

  private foul(offender: Pl, victim: Pl): void {
    offender.noControlUntil = this.t + 1.5;
    offender.vx *= 0.2;
    offender.vy *= 0.2;
    this.ball.owner = victim;
    this.ball.pass = null;
    this.spot(offender.id, 2);
    this.setDead(victim, { x: victim.x, y: victim.y }, 1.1);
  }

  private setDead(taker: Pl, at: Vec, wait: number): void {
    this.phase = 'dead';
    this.phaseUntil = this.t + wait;
    this.dead = { taker, at: { x: clamp(at.x, 0.5, L - 0.5), y: clamp(at.y, 0.3, W - 0.3) } };
    const b = this.ball;
    b.owner = null;
    b.pass = null;
    b.shot = null;
    b.vx = b.vy = b.vz = 0;
    b.z = 0;
    b.x = this.dead.at.x;
    b.y = this.dead.at.y;
  }

  private setupKickoff(side: Side, wait = 2): void {
    this.phase = 'kickoff';
    this.phaseUntil = this.t + wait;
    this.kickoffSide = side;
    const b = this.ball;
    Object.assign(b, { x: L / 2, y: W / 2, z: 0, vx: 0, vy: 0, vz: 0, owner: null, pass: null, shot: null });
    this.players.forEach((p) => (p.run = null));
  }

  private addPending(side: Side, delta: number): void {
    this.pendingGoals.update((p) => ({ ...p, [side]: Math.max(0, p[side] + delta) }));
  }

  private goalScored(side: Side, scorer: string): void {
    const head = this.directives[0];
    if (head?.kind === 'shot' && head.result === 'goal' && !head.scored) {
      head.scored = true;
      this.addPending(side, -1);
    }
    const scorerPl = this.players.find((p) => p.name === scorer && p.side === side && !p.leaving) ?? null;
    this.phase = 'celebrate';
    this.celebration = { side, scorer, start: this.t, until: this.t + 3, scorerPl };
    this.phaseUntil = this.t + 3;
    this.ball.shot = null;
    this.ball.pass = null;
  }

  private updateBall(dt: number): void {
    const b = this.ball;
    if (b.owner) {
      // Conduite : le ballon reste dans les pieds, légèrement devant le porteur.
      const o = b.owner;
      const sp = Math.hypot(o.vx, o.vy);
      const fx = sp > 0.3 ? o.vx / sp : o.side === 'home' ? 1 : -1;
      const fy = sp > 0.3 ? o.vy / sp : 0;
      b.x += (o.x + fx * 0.7 - b.x) * Math.min(1, dt * 18);
      b.y += (o.y + fy * 0.7 - b.y) * Math.min(1, dt * 18);
      b.z = 0;
      b.vx = o.vx;
      b.vy = o.vy;
      return;
    }
    if (this.phase === 'dead' || this.phase === 'kickoff') return;
    // Vol et rebonds.
    if (b.z > 0 || b.vz > 0) {
      b.vz -= GRAVITY * dt;
      b.z += b.vz * dt;
      if (b.z <= 0) {
        b.z = 0;
        b.vz = Math.abs(b.vz) > 2 ? -b.vz * 0.4 : 0;
        // Une frappe garde sa vitesse jusqu'au but ; une passe perd de l'élan au rebond.
        const keep = b.shot ? 0.95 : 0.75;
        b.vx *= keep;
        b.vy *= keep;
      }
    }
    if (b.z <= 0.01 && !b.shot) {
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > 0) {
        const ns = Math.max(0, sp - ROLL_DECEL * dt - sp * 0.08 * dt);
        b.vx *= ns / sp;
        b.vy *= ns / sp;
      }
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    // Tir : le gardien plonge (arrêt) ou est battu (but) ; la frappe manquée sort.
    if (b.shot) {
      const s = b.shot;
      const goalX = s.side === 'home' ? L : 0;
      const crossed = s.side === 'home' ? b.x >= goalX : b.x <= goalX;
      // Sécurité : une frappe qui s'arrête avant la ligne est reprise par le gardien.
      if (!crossed && Math.hypot(b.vx, b.vy) < 1.5 && b.z <= 0.01) {
        if (s.result === 'goal') {
          const d = Math.max(1, Math.abs(goalX - b.x));
          b.vx = ((goalX - b.x) / d) * 12;
          b.vy = (W / 2 - b.y) * 0.3;
        } else {
          b.shot = null;
          const k = this.keeper(s.side === 'home' ? 'away' : 'home');
          if (k) this.setDead(k, { x: b.x, y: b.y }, 1.2);
        }
        return;
      }
      if (s.result === 'save' && s.keeper && (dist(b, s.keeper) < 1.7 || crossed)) {
        const k = s.keeper;
        b.shot = null;
        b.owner = k;
        b.vx = b.vy = b.vz = 0;
        b.z = 0;
        k.vx = k.vy = 0;
        this.setDead(k, { x: k.x, y: k.y }, 1.3);
        this.dead!.at = { x: k.x, y: k.y };
        return;
      }
      if (crossed) {
        if (s.result === 'goal') return this.goalScored(s.side, s.scorer);
        b.shot = null;
        this.goalKick(s.side === 'home' ? 'away' : 'home');
        return;
      }
      return;
    }

    // Sorties de terrain.
    if (b.y < 0 || b.y > W) {
      const to: Side = b.last?.side === 'home' ? 'away' : 'home';
      const at = { x: clamp(b.x, 2, L - 2), y: b.y < 0 ? 0.3 : W - 0.3 };
      const taker = this.nearest(to, at);
      if (taker) this.setDead(taker, at, 1.4);
      return;
    }
    if (b.x < 0 || b.x > L) {
      const defending: Side = b.x < 0 ? 'home' : 'away';
      this.goalKick(defending);
      return;
    }

    // Passe morte (trop courte) : le ballon redevient libre, tout le monde peut le disputer.
    if (b.pass && b.z <= 0.01 && Math.hypot(b.vx, b.vy) < 1.2) b.pass = null;

    // Contrôle du ballon.
    for (const p of this.active()) {
      if (this.t < p.noControlUntil) continue;
      const reach = p.gk ? 1.5 : 1.0;
      if (b.z > (p.gk ? 2.4 : 1.6) || dist(p, b) > reach) continue;
      const pass = b.pass;
      if (pass && p !== pass.receiver) {
        // Chaque joueur ne tente l'interception qu'une fois par demi-seconde.
        const last = pass.tried.get(p) ?? -1;
        if (this.t - last < 0.5) continue;
        pass.tried.set(p, this.t);
        const opponent = p.side !== pass.side;
        if (!opponent) {
          if (Math.hypot(b.vx, b.vy) > 7) continue;
        } else {
          // Interception : rare si l'action du moteur est en cours pour l'équipe qui passe, fréquente si l'autre doit récupérer.
          let chance = 0.45;
          if (this.directives[0] && this.directives[0].side === pass.side) chance = 0.06;
          if (this.wantSide === p.side) chance = 0.9;
          if (Math.random() > chance) continue;
        }
      }
      this.gainBall(p);
      return;
    }
  }

  private gainBall(p: Pl): void {
    const b = this.ball;
    b.owner = p;
    b.pass = null;
    b.vz = 0;
    b.z = 0;
    p.dribble = null;
    this.nextThink = this.t + rnd(0.25, 0.6);
    if (this.wantSide === p.side) this.wantSide = null;
  }

  private goalKick(side: Side): void {
    const k = this.keeper(side);
    const at = { x: side === 'home' ? 5.5 : L - 5.5, y: W / 2 + rnd(-6, 6) };
    if (k) this.setDead(k, at, 1.6);
  }

  // ------------------------------------------------------------------ décisions du porteur

  private laneClear(from: Vec, to: Vec, side: Side): number {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len2 = dx * dx + dy * dy || 1;
    let min = Infinity;
    for (const o of this.active()) {
      if (o.side === side) continue;
      const tt = clamp(((o.x - from.x) * dx + (o.y - from.y) * dy) / len2);
      min = Math.min(min, Math.hypot(from.x + dx * tt - o.x, from.y + dy * tt - o.y));
    }
    return min;
  }

  private pressureOn(p: Vec, side: Side): number {
    let n = 0;
    for (const o of this.active()) if (o.side !== side && dist(o, p) < 6) n += (6 - dist(o, p)) / 6;
    return n;
  }

  private think(): void {
    const o = this.ball.owner;
    if (!o || this.phase !== 'play') return;
    const side = o.side;
    const dir = side === 'home' ? 1 : -1;
    const { i } = this.teamView(side);
    const bias = this.biasFor(side);
    const maxLen = i.passing === 'short' ? 24 : i.passing === 'direct' ? 40 : 32;
    const loftedOk = i.passing === 'direct' || (this.directives[0]?.kind === 'attack' && !!(this.directives[0] as { counter?: boolean }).counter);
    const pressure = this.pressureOn(o, side);

    // Le gardien relance.
    if (o.gk) {
      const long = i.distribution === 'long' || (i.distribution === 'mixed' && Math.random() < 0.35);
      const pool = this.active(side).filter((m) => (long ? m.line === 'MID' || m.line === 'ATT' : m.line === 'DEF'));
      const m = pool.sort((a, b) => this.pressureOn(a, side) - this.pressureOn(b, side))[0];
      if (m) this.kick(o, this.predict(m), m, long);
      return;
    }

    type Opt = { score: number; run: () => void };
    const opts: Opt[] = [];
    for (const m of this.active(side)) {
      if (m === o) continue;
      const aim = m.run && m.run.until > this.t && m === bias.player ? { x: m.x * 0.4 + m.run.x * 0.6, y: m.y * 0.4 + m.run.y * 0.6 } : this.predict(m, 0.6);
      const d = dist(o, aim);
      const isBias = m === bias.player;
      const lofted = d > maxLen || (isBias && d > 26);
      if (d < 5 || d > (lofted ? (loftedOk || isBias ? 55 : 0) : maxLen)) continue;
      const lane = this.laneClear(o, aim, side);
      if (!lofted && lane < 1.6 && !isBias) continue;
      const progress = (aim.x - o.x) * dir;
      let score = progress * 0.1 + Math.min(lane, 6) * 0.3 - this.pressureOn(aim, side) * 0.8 + Math.random() * 0.8;
      if (progress < -10) score -= 0.8;
      if (m.gk) score -= pressure > 1 ? 0 : 3;
      if (isBias) score += 5;
      if (lofted) score -= 1.2;
      opts.push({ score, run: () => this.kick(o, aim, m, lofted) });
    }
    // Conduite de balle si l'espace est libre devant.
    const goal = this.attackGoal(side);
    const ahead = { x: o.x + dir * 8, y: o.y + (goal.y - o.y) * 0.15 };
    const space = this.laneClear(o, ahead, side);
    if (space > 3) {
      const target = bias.player === o && bias.point ? bias.point : ahead;
      opts.push({ score: 1.2 + (space - 3) * 0.25 + (bias.player === o ? 4 : 0) + Math.random() * 0.6, run: () => (o.dribble = { x: clamp(target.x, 2, L - 2), y: clamp(target.y, 2, W - 2) }) });
    }
    opts.sort((a, b) => b.score - a.score);
    if (opts.length) opts[0].run();
    else o.dribble = { x: clamp(o.x + dir * 4, 2, L - 2), y: o.y };
  }

  // ------------------------------------------------------------------ boucle

  private update(dt: number): void {
    this.t += dt;
    const b = this.ball;

    if (this.phase === 'celebrate') {
      if (this.t >= this.phaseUntil && this.celebration) {
        const conceding: Side = this.celebration.side === 'home' ? 'away' : 'home';
        this.celebration = null;
        this.setupKickoff(conceding, 2.2);
      }
    } else if (this.phase === 'kickoff') {
      if (this.t >= this.phaseUntil) {
        const taker = this.nearest(this.kickoffSide, { x: L / 2, y: W / 2 });
        this.phase = 'play';
        if (taker) {
          b.owner = taker;
          taker.x = L / 2 + (this.kickoffSide === 'home' ? -0.6 : 0.6);
          taker.y = W / 2;
          const mate = this.nearest(this.kickoffSide, this.toPitch(this.kickoffSide, 0.38, 0.5), false, taker);
          if (mate) this.kick(taker, this.predict(mate), mate, false);
        }
      }
    } else if (this.phase === 'dead' && this.dead) {
      const { taker, at } = this.dead;
      if (taker.leaving) this.dead.taker = this.nearest(taker.side, at, true) ?? taker;
      if (dist(this.dead.taker, at) < 1.2 && this.t >= this.phaseUntil) {
        this.phase = 'play';
        this.dead = null;
        b.owner = taker;
        this.nextThink = this.t + 0.05;
      }
    }

    if (this.phase === 'play') {
      this.direct();
      if (b.owner && this.t >= this.nextThink) {
        this.nextThink = this.t + rnd(0.7, 1.4) / (this.teamView(b.owner.side).i.tempo === 'fast' ? 1.25 : this.teamView(b.owner.side).i.tempo === 'slow' ? 0.8 : 1);
        this.think();
      }
      this.tackles(dt);
    }
    this.updateBall(dt);
    this.movePlayers(dt);

    if (b.shot) {
      this.trail.push({ x: b.x, y: b.y });
      if (this.trail.length > 12) this.trail.shift();
    } else if (this.trail.length) this.trail.shift();
    this.players = this.players.filter((p) => !(p.leaving && p.y > W + 2));
  }

  /** Duels : un adversaire collé au porteur peut lui prendre le ballon. */
  private tackles(dt: number): void {
    const o = this.ball.owner;
    if (!o || o.gk) return;
    const d = this.directives[0];
    for (const p of this.active()) {
      if (p.side === o.side || this.t < p.noControlUntil || dist(p, o) > 1.7) continue;
      const pressing = this.teamView(p.side).i.pressing;
      let rate = 0.7 * (pressing === 'high' ? 1.25 : pressing === 'low' ? 0.8 : 1);
      if (d && d.side === o.side) rate *= 0.12;
      if (this.wantSide === p.side) rate *= this.t - this.wantSince > 2 ? 12 : 5;
      if (d && d.kind === 'foul' && this.byId(d.offenderId) === p) rate = 0; // la faute arrivera
      if (Math.random() < rate * dt) {
        o.noControlUntil = this.t + 0.7;
        this.ball.owner = null;
        this.ball.last = o;
        this.ball.pass = null;
        // Le ballon part vers le tacleur.
        const ux = (p.x - o.x) || 0.1;
        const uy = (p.y - o.y) || 0.1;
        const n = Math.hypot(ux, uy);
        this.ball.vx = (ux / n) * 3;
        this.ball.vy = (uy / n) * 3;
        return;
      }
    }
  }

  private movePlayers(dt: number): void {
    const b = this.ball;
    const owner = b.owner;
    const holder = this.holderSide();
    const d0 = this.directives[0];
    const fouler = d0 && d0.kind === 'foul' ? this.byId(d0.offenderId) : null;

    // Presseurs de l'équipe sans ballon.
    const pressers = new Set<Pl>();
    if (this.phase === 'play' && holder) {
      const def: Side = holder === 'home' ? 'away' : 'home';
      const pressing = this.teamView(def).i.pressing;
      let count = pressing === 'high' ? 3 : pressing === 'low' ? 1 : 2;
      if (this.wantSide === def) count += 1;
      const radius = pressing === 'high' ? 30 : pressing === 'low' ? 14 : 22;
      this.active(def)
        .filter((p) => !p.gk && dist(p, b) < radius)
        .sort((a, c) => dist(a, b) - dist(c, b))
        .slice(0, count)
        .forEach((p) => pressers.add(p));
    }
    // Ballon libre : le plus proche de chaque équipe va le chercher.
    const chasers = new Set<Pl>();
    if (this.phase === 'play' && !owner && !b.shot) {
      const future = { x: b.x + b.vx * 0.4, y: b.y + b.vy * 0.4 };
      for (const side of ['home', 'away'] as const) {
        if (b.pass && b.pass.side === side) continue;
        const gk = this.keeper(side);
        const c = gk && dist(gk, future) < 12 ? gk : this.nearest(side, future);
        if (c) chasers.add(c);
      }
    }

    for (const p of this.players) {
      let target: Vec;
      let sprint = false;
      if (p.leaving) {
        target = { x: p.x, y: W + 3 };
      } else if (this.phase === 'celebrate' && this.celebration) {
        const c = this.celebration;
        if (c.scorerPl === p) {
          target = { x: c.side === 'home' ? L - 3 : 3, y: p.y < W / 2 ? 3 : W - 3 };
          sprint = true;
        } else if (p.side === c.side && c.scorerPl && !p.gk) {
          target = { x: c.scorerPl.x + rnd(-2, 2), y: c.scorerPl.y + rnd(-2, 2) };
        } else target = this.kickoffSpot(p, c.side === 'home' ? 'away' : 'home');
      } else if (this.phase === 'kickoff') {
        target = this.kickoffSpot(p, this.kickoffSide);
        if (p === this.nearest(this.kickoffSide, { x: L / 2, y: W / 2 })) target = { x: L / 2 + (this.kickoffSide === 'home' ? -0.6 : 0.6), y: W / 2 };
      } else if (this.phase === 'dead' && this.dead) {
        if (p === this.dead.taker) {
          target = this.dead.at;
          sprint = true;
        } else {
          target = this.shape(p);
          // Les adversaires reculent à distance réglementaire.
          if (p.side !== this.dead.taker.side && dist(target, this.dead.at) < 9) {
            const n = Math.max(0.1, dist(target, this.dead.at));
            target = { x: this.dead.at.x + ((target.x - this.dead.at.x) / n) * 9, y: this.dead.at.y + ((target.y - this.dead.at.y) / n) * 9 };
          }
        }
      } else if (owner === p) {
        target = p.dribble ?? { x: p.x + (p.side === 'home' ? 1 : -1) * 2, y: p.y };
        if (p.dribble && dist(p, p.dribble) < 1.5) p.dribble = null;
      } else if (b.pass && b.pass.receiver === p) {
        // Le destinataire va au point visé, puis attaque le ballon s'il arrive moins loin.
        const slow = Math.hypot(b.vx, b.vy) < 7 && b.z < 1;
        target = slow || dist(p, b.pass.aim) < 1.5 ? { x: b.x + b.vx * 0.25, y: b.y + b.vy * 0.25 } : b.pass.aim;
        sprint = true;
      } else if (b.shot && b.shot.keeper === p && p.gk) {
        // Plongeon : le gardien se jette sur la trajectoire… trop tard si le but est écrit.
        const goalX = b.shot.side === 'home' ? L : 0;
        const tt = Math.abs((goalX - b.x) / (b.vx || 1));
        const yAtLine = b.y + b.vy * tt;
        target = { x: p.x, y: clamp(yAtLine, W / 2 - GOAL_HALF, W / 2 + GOAL_HALF) };
        sprint = b.shot.result === 'save';
      } else if (fouler === p && owner && owner.side !== p.side) {
        target = owner;
        sprint = true;
      } else if (chasers.has(p)) {
        target = { x: b.x + b.vx * 0.4, y: b.y + b.vy * 0.4 };
        sprint = true;
      } else if (pressers.has(p) && owner) {
        const pull = this.wantSide === p.side ? 1 : 0.85;
        const s = this.shape(p);
        target = { x: s.x + (owner.x - s.x) * pull, y: s.y + (owner.y - s.y) * pull };
        sprint = this.wantSide === p.side;
      } else if (p.run && p.run.until > this.t && !p.gk) {
        target = p.run;
        sprint = true;
      } else {
        target = this.shape(p);
      }
      this.steer(p, target, sprint, dt);
    }
    // Évitement : deux joueurs ne se superposent pas.
    const act = this.active();
    for (let i = 0; i < act.length; i++) {
      for (let j = i + 1; j < act.length; j++) {
        const a = act[i];
        const c = act[j];
        const dd = dist(a, c);
        if (dd > 0 && dd < 1.1) {
          const push = ((1.1 - dd) / dd) * 0.5;
          const px = (a.x - c.x) * push;
          const py = (a.y - c.y) * push;
          if (a !== owner) {
            a.x += px * 0.5;
            a.y += py * 0.5;
          }
          if (c !== owner) {
            c.x -= px * 0.5;
            c.y -= py * 0.5;
          }
        }
      }
    }
  }

  private steer(p: Pl, target: Vec, sprint: boolean, dt: number): void {
    if (this.reducedMotion) {
      p.x = target.x;
      p.y = target.y;
      return;
    }
    const dx = target.x - p.x;
    const dy = target.y - p.y;
    const d = Math.hypot(dx, dy);
    const owner = this.ball.owner === p;
    const max = p.leaving ? 2.5 : owner ? 5.6 : sprint ? 7.6 : p.gk ? 4.5 : 5.2;
    const desired = d < 0.05 ? 0 : Math.min(max, d * 1.6);
    const tvx = d > 0 ? (dx / d) * desired : 0;
    const tvy = d > 0 ? (dy / d) * desired : 0;
    const ax = tvx - p.vx;
    const ay = tvy - p.vy;
    const an = Math.hypot(ax, ay);
    const maxAcc = (sprint ? 9 : 6) * dt;
    const k = an > maxAcc ? maxAcc / an : 1;
    p.vx += ax * k;
    p.vy += ay * k;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (!p.leaving) {
      p.x = clamp(p.x, -2, L + 2);
      p.y = clamp(p.y, -2, W + 2);
    }
  }

  // ------------------------------------------------------------------ rendu

  private resize(): void {
    const el = this.canvas().nativeElement;
    const w = el.clientWidth || 600;
    const h = Math.round(w * 0.64);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    el.width = Math.round(w * dpr);
    el.height = Math.round(h * dpr);
    el.style.height = `${h}px`;
    this.width = w;
    this.height = h;
    el.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.pitchCache = this.renderPitch(w, h, dpr);
  }

  private geometry() {
    const m = 16;
    const pw = this.width - m * 2;
    const ph = this.height - m * 2;
    return { m, pw, ph, X: (x: number) => m + (x / L) * pw, Y: (y: number) => m + (y / W) * ph };
  }

  private renderPitch(Wd: number, Hd: number, dpr: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = Math.round(Wd * dpr);
    c.height = Math.round(Hd * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { pw, ph, X, Y } = this.geometry();
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = i % 2 ? '#1d6a49' : '#1a6143';
      ctx.fillRect((Wd / 14) * i, 0, Wd / 14 + 1, Hd);
    }
    const glow = ctx.createRadialGradient(Wd / 2, Hd / 2, Hd * 0.2, Wd / 2, Hd / 2, Wd * 0.7);
    glow.addColorStop(0, 'rgba(255,255,255,0.05)');
    glow.addColorStop(1, 'rgba(0,0,0,0.28)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, Wd, Hd);
    ctx.strokeStyle = 'rgba(238, 244, 239, 0.85)';
    ctx.fillStyle = 'rgba(238, 244, 239, 0.85)';
    ctx.lineWidth = 2;
    ctx.strokeRect(X(0), Y(0), pw, ph);
    ctx.beginPath();
    ctx.moveTo(X(L / 2), Y(0));
    ctx.lineTo(X(L / 2), Y(W));
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(X(L / 2), Y(W / 2), (9.15 / W) * ph, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(X(L / 2), Y(W / 2), 2.5, 0, Math.PI * 2);
    ctx.fill();
    for (const side of [0, 1]) {
      const gx = side ? L : 0;
      const s = side ? -1 : 1;
      ctx.strokeRect(Math.min(X(gx), X(gx + s * 16.5)), Y(W / 2 - 20.16), (16.5 / L) * pw, (40.32 / W) * ph);
      ctx.strokeRect(Math.min(X(gx), X(gx + s * 5.5)), Y(W / 2 - 9.16), (5.5 / L) * pw, (18.32 / W) * ph);
      ctx.beginPath();
      ctx.arc(X(gx + s * 11), Y(W / 2), 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(X(gx + s * 11), Y(W / 2), (9.15 / W) * ph, side ? Math.PI * 0.6 : -Math.PI * 0.4, side ? Math.PI * 1.4 : Math.PI * 0.4);
      ctx.stroke();
      const netW = 9;
      const nx = side ? X(L) : X(0) - netW;
      ctx.fillStyle = 'rgba(238, 244, 239, 0.18)';
      ctx.fillRect(nx, Y(W / 2 - GOAL_HALF), netW, (GOAL_HALF * 2 * ph) / W);
      ctx.fillStyle = 'rgba(238, 244, 239, 0.85)';
    }
    return c;
  }

  private draw(now: number): void {
    const el = this.canvas().nativeElement;
    const ctx = el.getContext('2d');
    if (!ctx || !this.width) return;
    const { ph, X, Y } = this.geometry();
    const Wd = this.width;
    const Hd = this.height;
    if (this.pitchCache) ctx.drawImage(this.pitchCache, 0, 0, Wd, Hd);

    const r = Math.max(5, Wd * 0.011);
    const homeC = this.home().colors;
    const awayC = this.away().colors;
    const sorted = [...this.players].sort((a, b) => a.y - b.y);
    const owner = this.ball.owner;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    for (const p of sorted) {
      ctx.beginPath();
      ctx.ellipse(X(p.x) + 2, Y(p.y) + r * 0.7, r * 0.95, r * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const p of sorted) {
      const c = p.side === 'home' ? homeC : awayC;
      const px = X(p.x);
      const py = Y(p.y);
      ctx.globalAlpha = p.leaving ? 0.45 : 1;
      if (p === owner) {
        ctx.beginPath();
        ctx.arc(px, py, r + 4 + Math.sin(now / 160) * 0.8, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(244, 185, 66, 0.8)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fillStyle = p.gk ? '#f4b942' : c.primary;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = c.secondary;
      ctx.stroke();
      // Orientation (direction de course).
      const sp = Math.hypot(p.vx, p.vy);
      if (sp > 0.8) {
        ctx.beginPath();
        ctx.moveTo(px + (p.vx / sp) * r * 0.4, py + (p.vy / sp) * r * 0.4);
        ctx.lineTo(px + (p.vx / sp) * r * 1.5, py + (p.vy / sp) * r * 1.5);
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      if (p.yellow) {
        ctx.fillStyle = '#f4d742';
        ctx.fillRect(px + r * 0.55, py - r * 1.35, r * 0.5, r * 0.7);
      }
      ctx.globalAlpha = 1;
    }

    // Noms : porteur, destinataire de la passe, acteur de l'action du moteur.
    const named = new Set<Pl>();
    if (owner) named.add(owner);
    if (this.ball.pass) named.add(this.ball.pass.receiver);
    if (this.spotlight && this.t < this.spotlight.until) {
      const s = this.players.find((p) => p.id === this.spotlight!.id && !p.leaving);
      if (s) named.add(s);
    }
    const fontSize = Math.max(10, Math.round(Wd * 0.0145));
    ctx.font = `600 ${fontSize}px "Barlow", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (const p of named) {
      if (this.phase === 'celebrate' && p !== this.celebration?.scorerPl) continue;
      const px = X(p.x);
      const py = Y(p.y) - r - 4;
      const w = ctx.measureText(p.name).width + 8;
      ctx.fillStyle = 'rgba(7, 33, 26, 0.82)';
      ctx.fillRect(px - w / 2, py - fontSize - 3, w, fontSize + 4);
      ctx.fillStyle = '#eef4ef';
      ctx.fillText(p.name, px, py);
    }

    if (this.trail.length > 1) {
      ctx.lineCap = 'round';
      for (let i = 1; i < this.trail.length; i++) {
        ctx.beginPath();
        ctx.moveTo(X(this.trail[i - 1].x), Y(this.trail[i - 1].y));
        ctx.lineTo(X(this.trail[i].x), Y(this.trail[i].y));
        ctx.strokeStyle = `rgba(255, 255, 255, ${(i / this.trail.length) * 0.45})`;
        ctx.lineWidth = r * 0.7 * (i / this.trail.length);
        ctx.stroke();
      }
    }

    // Ballon : ombre au sol, ballon surélevé selon sa hauteur.
    const b = this.ball;
    const lift = (b.z / W) * ph * 0.9;
    const br = r * 0.5 * (1 + Math.min(b.z, 8) * 0.06);
    ctx.beginPath();
    ctx.ellipse(X(b.x) + 2, Y(b.y) + 2, r * 0.5, r * 0.3, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0, 0, 0, ${Math.max(0.12, 0.38 - b.z * 0.03)})`;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(X(b.x), Y(b.y) - lift, br, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(16, 35, 27, 0.6)';
    ctx.stroke();

    // Arrêt de jeu signalé.
    if (this.phase === 'dead' && this.dead) {
      ctx.font = `600 ${fontSize}px "Barlow", system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(244, 185, 66, 0.9)';
      ctx.textAlign = 'center';
      ctx.fillText('●', X(this.dead.at.x), Y(this.dead.at.y) + r * 2.4);
    }

    if (this.celebration) {
      const c = this.celebration;
      const t = clamp((this.t - c.start) / (c.until - c.start));
      const team = c.side === 'home' ? this.home() : this.away();
      const colors = c.side === 'home' ? homeC : awayC;
      const pop = t < 0.15 ? easeOut(t / 0.15) * 1.1 : t < 0.25 ? 1.1 - ((t - 0.15) / 0.1) * 0.1 : 1;
      ctx.save();
      ctx.globalAlpha = Math.min(1, (1 - t) * 3);
      ctx.fillStyle = 'rgba(7, 33, 26, 0.55)';
      ctx.fillRect(0, Hd * 0.34, Wd, Hd * 0.32);
      ctx.fillStyle = colors.primary;
      ctx.fillRect(0, Hd * 0.34, Wd * easeOut(Math.min(1, t * 3)), 4);
      ctx.fillRect(Wd * (1 - easeOut(Math.min(1, t * 3))), Hd * 0.66 - 4, Wd, 4);
      ctx.translate(Wd / 2, Hd / 2);
      ctx.scale(pop, pop);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `700 ${Math.round(Hd * 0.14)}px "Barlow Condensed", "Arial Narrow", sans-serif`;
      ctx.fillStyle = '#f4b942';
      ctx.fillText(`BUT ! ${team.name.toUpperCase()}`, 0, -Hd * 0.03, Wd - 32);
      ctx.font = `600 ${Math.round(Hd * 0.055)}px "Barlow", system-ui, sans-serif`;
      ctx.fillStyle = '#eef4ef';
      ctx.fillText(c.scorer, 0, Hd * 0.08, Wd - 32);
      ctx.restore();
    }
  }
}
