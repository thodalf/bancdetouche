import { TeamTalkTone, DEFAULT_INSTRUCTIONS, FormationId, FormationSlot, FORMATIONS, MatchEvent, MatchStats, Player, POSITION_GROUP, Position, SCENARIO_TRIGGERS, ScenarioTrigger, SideInput, STYLE_LABELS, TeamInstructions, TeamStyle } from '../models';
import { GAME_PLANS, GamePlanId, Scenario, tacticalMods } from './game-plans';
import { line } from './commentary';
import { rollInjury } from './fitness';
import { autoPickLineup, effectiveRating, isAvailable, positionFit, teamStrength, TeamStrength } from './lineup';
import { Rng } from './rng';

export type Side = 'home' | 'away';

export type { SideInput } from '../models';

/** Joueur sur le terrain, vu par l'interface de match. */
export interface PitchPlayer {
  player: Player;
  role: Position;
  slot: number;
  yellow: boolean;
  /** Condition physique dans le match (100 = frais). */
  stamina: number;
}

/** Condition physique d'un joueur au coup d'envoi, selon sa fatigue accumulée. */
export function startingStamina(p: Pick<Player, 'fatigue'>): number {
  return Math.max(40, Math.round(100 - p.fatigue * 0.6));
}

/** Dernière action de jeu, utilisée par la visualisation 2D. */
export interface MatchAction {
  minute: number;
  /** Équipe qui a le ballon à l'issue de l'action (pour une faute : l'équipe qui obtient le coup franc). */
  side: Side;
  kind: 'possession' | 'attack' | 'shot' | 'goal' | 'save' | 'miss' | 'foul';
  /** Acteur : porteur, tireur, buteur ou auteur de la faute. */
  playerId?: string;
  /** Passeur décisif (but). */
  assistId?: string;
  /** Gardien qui s'interpose (arrêt). */
  keeperId?: string;
  /** Couloir de l'attaque (selon la consigne « couloir d'attaque »). */
  zone?: 'left' | 'center' | 'right';
  counter?: boolean;
  /** Numéro d'ordre unique (l'animation rejoue chaque action une seule fois). */
  seq: number;
}

export interface MatchResult {
  homeGoals: number;
  awayGoals: number;
  penalties?: { home: number; away: number };
  events: MatchEvent[];
  stats: MatchStats;
  /** Note de chaque joueur ayant participé. */
  ratings: Record<string, number>;
  /** Joueurs blessés pendant le match. */
  injuries: Record<string, { weeks: number; name: string }>;
  /** Joueurs ayant joué (titulaires + entrants). */
  participants: string[];
  goals: { playerId: string; assistId?: string; side: Side }[];
}

interface SideState {
  input: SideInput;
  formation: FormationId;
  lineup: (string | null)[];
  subbedOff: Set<string>;
  roles: Position[];
  bench: Player[];
  style: TeamStyle;
  instructions: TeamInstructions;
  /** Endurance collective dans le match (100 au coup d'envoi), entamée par le pressing et l'intensité. */
  energy: number;
  /** Condition physique de chaque joueur entré en jeu (100 = frais). */
  stamina: Map<string, number>;
  /** Facteur « jambes » de la minute (condition moyenne du onze), recalculé à chaque minute. */
  legs: number;
  /** Effectif indexé (il ne change pas pendant le match). */
  byId: Map<string, Player>;
  /** Dernier plan de jeu adopté par l'IA (évite de répéter le même changement). */
  aiPlan?: GamePlanId;
  /** Dernière règle de scénario appliquée (consignes conditionnelles de l'entraîneur). */
  ruleKey?: string;
  /** Effet de la causerie de mi-temps sur la seconde période. */
  talkBoost: number;
  talked: boolean;
  subsUsed: number;
  yellows: Set<string>;
  sentOff: Set<string>;
  participants: Set<string>;
  strength: TeamStrength;
  shots: number;
  onTarget: number;
}

/** Paramètres du moteur, ajustés pour obtenir ~2,7 buts et ~12 tirs par équipe et par match. */
const ATTACK_RATE = 0.45;
const HOME_BOOST = 1.045;
export const MAX_SUBS = 5;


/**
 * Simulation minute par minute. Utilisable en direct (step) depuis l'interface
 * ou d'une traite (runToEnd) pour les autres matchs de la journée.
 */
export class MatchSimulation {
  minute = 0;
  homeGoals = 0;
  awayGoals = 0;
  readonly events: MatchEvent[] = [];
  private readonly sides: Record<Side, SideState>;
  private possessionAcc = 0;
  private readonly goalsLog: MatchResult['goals'] = [];
  private readonly ratingAdj = new Map<string, number>();
  private readonly injuries: Record<string, { weeks: number; name: string }> = {};
  /** Dernière action jouée (pour l'animation). */
  lastAction: MatchAction = { minute: 0, side: 'home', kind: 'possession', seq: 0 };
  /** Actions de la dernière minute jouée, dans l'ordre (pour l'animation). */
  minuteActions: MatchAction[] = [];
  private seq = 0;
  /** Tirages purement visuels (porteurs du ballon, couloirs) : n'influencent jamais le résultat. */
  private readonly vis: Rng;
  private penalties?: { home: number; away: number };
  private done = false;

  constructor(
    home: SideInput,
    away: SideInput,
    private readonly rng: Rng,
    private readonly allowDraw = true,
  ) {
    this.sides = { home: this.initSide(home), away: this.initSide(away) };
    this.vis = new Rng([...`${home.clubId}${away.clubId}`].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7));
    this.refresh('home');
    this.refresh('away');
    this.push({ minute: 0, type: 'kickoff', text: `Coup d'envoi : ${home.name} – ${away.name}.` });
  }

  get finished(): boolean {
    return this.done;
  }

  get stats(): MatchStats {
    const played = Math.max(1, this.minute);
    return {
      possessionHome: Math.round((this.possessionAcc / played) * 100),
      shotsHome: this.sides.home.shots,
      shotsAway: this.sides.away.shots,
      onTargetHome: this.sides.home.onTarget,
      onTargetAway: this.sides.away.onTarget,
    };
  }

  styleOf(side: Side): TeamStyle {
    return this.sides[side].style;
  }

  setStyle(side: Side, style: TeamStyle): void {
    if (this.sides[side].style === style) return;
    this.sides[side].style = style;
    this.push({ minute: this.minute, type: 'info', side, text: `${this.sides[side].input.name} passe en mode ${styleText(style)}.` });
  }

  instructionsOf(side: Side): TeamInstructions {
    return this.sides[side].instructions;
  }

  energyOf(side: Side): number {
    return Math.round(this.sides[side].energy);
  }

  /** Condition physique d'un joueur (titulaire, entrant ou remplaçant pas encore entré). */
  staminaOf(side: Side, playerId: string): number {
    const s = this.sides[side];
    const known = s.stamina.get(playerId);
    if (known !== undefined) return Math.round(known);
    const p = s.input.squad.find((x) => x.id === playerId);
    return p ? startingStamina(p) : 100;
  }

  redCardsOf(side: Side): number {
    return this.sides[side].sentOff.size;
  }

  yellowCardsOf(side: Side): number {
    return this.sides[side].yellows.size;
  }

  /** Situation du match du point de vue d'une équipe (pour conseiller un plan de jeu). */
  scenario(side: Side): Scenario {
    const other: Side = side === 'home' ? 'away' : 'home';
    return {
      minute: this.minute,
      diff: side === 'home' ? this.homeGoals - this.awayGoals : this.awayGoals - this.homeGoals,
      ownReds: this.sides[side].sentOff.size,
      oppReds: this.sides[other].sentOff.size,
      ownYellows: this.sides[side].yellows.size,
      energy: this.sides[side].energy,
      balance: this.sides[side].strength.overall / Math.max(1, this.sides[other].strength.overall),
      opponent: this.sides[other].instructions,
    };
  }

  /** Modifie les consignes (et éventuellement la mentalité) en une seule décision. */
  setInstructions(side: Side, changes: Partial<TeamInstructions>, style?: TeamStyle, label?: string): void {
    const s = this.sides[side];
    if (this.done) return;
    s.instructions = { ...s.instructions, ...changes };
    if (style) s.style = style;
    const text = label ? `${s.input.name} adopte le plan « ${label} ».` : `${s.input.name} ajuste ses consignes.`;
    this.push({ minute: this.minute, type: 'info', side, text });
  }

  /**
   * Causerie de la mi-temps : son effet dépend du score. Secouer une équipe menée la réveille,
   * mais secouer une équipe qui gagne la crispe ; le calme rassure une équipe qui mène.
   */
  teamTalk(side: Side, tone: TeamTalkTone): string | null {
    const s = this.sides[side];
    if (s.talked) return 'La causerie a déjà eu lieu.';
    if (this.minute < 45 || this.minute > 46) return 'La causerie se fait à la mi-temps.';
    const diff = side === 'home' ? this.homeGoals - this.awayGoals : this.awayGoals - this.homeGoals;
    const effect: Record<TeamTalkTone, number> =
      diff > 0
        ? { calm: 0.025, encourage: 0.015, angry: -0.02, focus: 0.015 }
        : diff === 0
          ? { calm: 0.005, encourage: 0.025, angry: 0.01, focus: 0.02 }
          : diff === -1
            ? { calm: -0.01, encourage: 0.02, angry: 0.035, focus: 0.02 }
            : { calm: -0.02, encourage: 0.01, angry: 0.03, focus: 0.01 };
    s.talked = true;
    s.talkBoost = effect[tone];
    if (tone === 'calm') s.energy = Math.min(100, s.energy + 4);
    const verdict = s.talkBoost >= 0.02 ? 'Les joueurs reviennent transcendés.' : s.talkBoost > 0 ? 'Le message passe.' : 'Le discours tombe à plat.';
    const label: Record<TeamTalkTone, string> = { calm: 'appelle au calme', encourage: 'encourage ses joueurs', angry: 'pousse un coup de gueule', focus: 'insiste sur le plan de jeu' };
    this.push({ minute: this.minute, type: 'info', side, text: `Causerie : l'entraîneur de ${s.input.name} ${label[tone]}. ${verdict}` });
    return null;
  }

  talkDone(side: Side): boolean {
    return this.sides[side].talked;
  }

  /** Applique un plan de jeu prédéfini (mentalité + consignes). */
  applyPlan(side: Side, plan: GamePlanId): void {
    const p = GAME_PLANS[plan];
    this.setInstructions(side, p.instructions, p.style, p.label);
  }

  formationOf(side: Side): FormationId {
    return this.sides[side].formation;
  }

  /** Positions des postes (personnalisées au coup d'envoi, sinon celles de la formation). */
  slotsOf(side: Side): FormationSlot[] {
    const s = this.sides[side];
    const custom = s.input.tactic.slots;
    return custom && custom.length === s.roles.length && s.formation === s.input.tactic.formation ? custom : FORMATIONS[s.formation].slots;
  }

  subsLeft(side: Side): number {
    return MAX_SUBS - this.sides[side].subsUsed;
  }

  /** Joueurs actuellement sur le terrain (dans l'ordre des postes de la formation). */
  onField(side: Side): PitchPlayer[] {
    const s = this.sides[side];
    const byId = s.byId;
    return s.lineup
      .map((id, i) => (id && byId.get(id) ? { player: byId.get(id)!, role: s.roles[i], slot: i, yellow: s.yellows.has(id), stamina: this.staminaOf(side, id) } : null))
      .filter((x): x is PitchPlayer => !!x);
  }

  /** Remplaçants encore disponibles (ni sortis, ni blessés). */
  benchOf(side: Side): Player[] {
    const s = this.sides[side];
    return s.bench.filter((p) => !s.subbedOff.has(p.id) && !this.injuries[p.id]);
  }

  /** Remplacement : le joueur entrant prend le poste du sortant. */
  substitute(side: Side, outId: string, inId: string): string | null {
    const s = this.sides[side];
    if (this.done) return 'Le match est terminé.';
    if (s.subsUsed >= MAX_SUBS) return `Les ${MAX_SUBS} remplacements ont été effectués.`;
    const idx = s.lineup.indexOf(outId);
    const incoming = s.bench.find((p) => p.id === inId);
    if (idx < 0) return "Ce joueur n'est pas sur le terrain.";
    if (!incoming || s.subbedOff.has(inId)) return "Ce joueur ne peut pas entrer en jeu.";
    const outgoing = s.input.squad.find((p) => p.id === outId)!;
    s.lineup[idx] = inId;
    s.bench = s.bench.filter((p) => p.id !== inId);
    s.subbedOff.add(outId);
    s.subsUsed++;
    s.participants.add(inId);
    s.stamina.set(inId, startingStamina(incoming));
    // Un joueur frais redonne un peu d'allant à l'équipe.
    s.energy = Math.min(100, s.energy + 4 + (s.input.subEnergy ?? 0));
    this.refresh(side);
    this.push({ minute: this.minute, type: 'info', side, text: `Changement pour ${s.input.name} : ${shortName(incoming)} remplace ${shortName(outgoing)}.` });
    return null;
  }

  /** Changement de système : les joueurs présents sont redistribués sur les postes de la nouvelle formation. */
  changeFormation(side: Side, formation: FormationId): void {
    const s = this.sides[side];
    if (s.formation === formation || this.done) return;
    const players = this.onField(side).map((x) => x.player);
    s.formation = formation;
    s.roles = FORMATIONS[formation].slots.map((x) => x.role);
    s.input = { ...s.input, tactic: { ...s.input.tactic, slots: undefined } };
    // On garde les mêmes joueurs (un expulsé laisse un poste vide), placés au mieux.
    const lineup = autoPickLineup(players, formation);
    s.lineup = lineup.slice(0, s.roles.length);
    this.refresh(side);
    this.push({ minute: this.minute, type: 'info', side, text: `${s.input.name} passe en ${formation}.` });
  }

  /** Avance d'une minute. Retourne les événements produits. */
  step(): MatchEvent[] {
    if (this.done) return [];
    const before = this.events.length;
    this.minute++;
    this.minuteActions = [];
    this.drainEnergy();
    this.playMinute();
    this.aiSubstitutions();
    this.aiGamePlan();
    this.scenarioRules();
    if (this.minute === 45) {
      this.push({ minute: 45, type: 'halftime', text: `Mi-temps : ${this.scoreText()}.` });
    }
    if (this.minute >= 90) this.finish();
    return this.events.slice(before);
  }

  runToEnd(): MatchResult {
    while (!this.done) this.step();
    return this.result();
  }

  result(): MatchResult {
    const participants = [...this.sides.home.participants, ...this.sides.away.participants];
    return {
      homeGoals: this.homeGoals,
      awayGoals: this.awayGoals,
      penalties: this.penalties,
      events: this.events,
      stats: this.stats,
      ratings: this.computeRatings(),
      injuries: this.injuries,
      participants,
      goals: this.goalsLog,
    };
  }

  // ---------------------------------------------------------------- interne

  private initSide(input: SideInput): SideState {
    const lineup = [...input.tactic.lineup];
    const starters = new Set(lineup.filter((x): x is string => !!x));
    return {
      input,
      formation: input.tactic.formation,
      lineup,
      subbedOff: new Set(),
      roles: (input.tactic.slots?.length === input.tactic.lineup.length ? input.tactic.slots : FORMATIONS[input.tactic.formation].slots).map((s) => s.role),
      bench: input.squad.filter((p) => !starters.has(p.id) && isAvailable(p)),
      style: input.tactic.style,
      instructions: { ...DEFAULT_INSTRUCTIONS, ...input.tactic.instructions },
      energy: 100,
      stamina: new Map(input.squad.filter((p) => starters.has(p.id)).map((p) => [p.id, startingStamina(p)])),
      legs: 1,
      byId: new Map(input.squad.map((p) => [p.id, p])),
      talkBoost: 0,
      talked: false,
      subsUsed: 0,
      yellows: new Set(),
      sentOff: new Set(),
      participants: starters,
      strength: teamStrength(input.tactic, input.squad),
      shots: 0,
      onTarget: 0,
    };
  }

  private refresh(side: Side): void {
    const s = this.sides[side];
    s.strength = teamStrength({ ...s.input.tactic, formation: s.formation, lineup: s.lineup }, s.input.squad);
  }

  private mods(side: Side) {
    const s = this.sides[side];
    const other = this.sides[side === 'home' ? 'away' : 'home'];
    const lead = (side === 'home' ? this.homeGoals - this.awayGoals : this.awayGoals - this.homeGoals) > 0;
    return tacticalMods(s.style, s.instructions, lead, other.instructions);
  }

  /** L'endurance collective baisse à chaque minute, plus vite avec un pressing haut. */
  private drainEnergy(): void {
    for (const side of ['home', 'away'] as Side[]) {
      const s = this.sides[side];
      const drain = 0.33 + this.mods(side).drain;
      s.energy = Math.max(20, s.energy - drain);
      // Condition de chaque joueur : l'âge et le poste pèsent (un gardien court peu).
      for (const x of this.onPitch(side)) {
        const age = x.p.age >= 32 ? 1.25 : x.p.age >= 29 ? 1.1 : x.p.age <= 21 ? 0.9 : 1;
        const role = x.role === 'GK' ? 0.3 : 1;
        const cur = s.stamina.get(x.p.id) ?? startingStamina(x.p);
        s.stamina.set(x.p.id, Math.max(15, cur - (drain + 0.05) * age * role));
      }
      const field = this.onPitch(side);
      const avg = field.reduce((sum, x) => sum + (s.stamina.get(x.p.id) ?? 100), 0) / Math.max(1, field.length);
      s.legs = 0.95 + (avg / 100) * 0.05;
    }
  }

  /**
   * L'IA lit le scénario du match et change de plan : pousser quand elle est menée,
   * fermer le jeu quand elle mène en fin de match, se regrouper à dix.
   */
  private aiGamePlan(): void {
    if (this.minute < 55 || this.minute % 5 !== 0) return;
    for (const side of ['home', 'away'] as Side[]) {
      const s = this.sides[side];
      if (!s.input.aiControlled) continue;
      const diff = side === 'home' ? this.homeGoals - this.awayGoals : this.awayGoals - this.homeGoals;
      const short = s.sentOff.size > this.sides[side === 'home' ? 'away' : 'home'].sentOff.size;
      let plan: GamePlanId | undefined;
      if (diff < 0) plan = this.minute >= 80 ? 'allOut' : 'push';
      else if (diff > 0 && this.minute >= 75) plan = 'killGame';
      else if (short) plan = 'compact';
      if (plan && plan !== s.aiPlan) {
        s.aiPlan = plan;
        this.applyPlan(side, plan);
      }
    }
  }

  /**
   * Consignes conditionnelles préparées sur la page Tactique : dès qu'un scénario se présente
   * (mené, devant, réduit à dix…), le plan correspondant est appliqué automatiquement.
   */
  private scenarioRules(): void {
    for (const side of ['home', 'away'] as Side[]) {
      const s = this.sides[side];
      const rules = s.input.tactic.scenarios;
      if (!rules) continue;
      const sc = this.scenario(side);
      const holds: Record<ScenarioTrigger, boolean> = {
        downToTen: sc.ownReds > sc.oppReds,
        upAgainstTen: sc.oppReds > sc.ownReds,
        trailing: sc.diff < 0,
        leading: sc.diff > 0,
        drawing: sc.diff === 0,
        tired: sc.energy < 55,
      };
      const match = SCENARIO_TRIGGERS.find((t) => {
        const rule = rules[t.id];
        return !!rule && holds[t.id] && this.minute >= rule.from && !!GAME_PLANS[rule.plan as GamePlanId];
      });
      if (!match) continue;
      const rule = rules[match.id]!;
      const key = `${match.id}:${rule.plan}`;
      if (s.ruleKey === key) continue;
      s.ruleKey = key;
      const p = GAME_PLANS[rule.plan as GamePlanId];
      s.instructions = { ...DEFAULT_INSTRUCTIONS, ...p.instructions };
      s.style = p.style;
      this.push({ minute: this.minute, type: 'info', side, text: `${s.input.name} — consigne de scénario (${match.label.toLowerCase()}) : « ${p.label} ».` });
    }
  }

  /** L'IA fait entrer des joueurs frais à l'heure de jeu, au même poste. */
  private aiSubstitutions(): void {
    if (![62, 70, 78].includes(this.minute)) return;
    for (const side of ['home', 'away'] as Side[]) {
      const s = this.sides[side];
      if (!s.input.aiControlled || s.subsUsed >= 3) continue;
      const tired = this.onField(side)
        .filter((x) => x.role !== 'GK')
        .sort((a, b) => a.stamina - b.stamina)[0];
      if (!tired) continue;
      const sub = this.benchOf(side)
        .filter((p) => POSITION_GROUP[p.position] === POSITION_GROUP[tired.role])
        .sort((a, b) => effectiveRating(b, tired.role) - effectiveRating(a, tired.role))[0];
      if (sub && effectiveRating(sub, tired.role) >= effectiveRating(tired.player, tired.role) * 0.9) this.substitute(side, tired.player.id, sub.id);
    }
  }

  /** Force effective d'un compartiment, avec moral, style et avantage du terrain. */
  private power(side: Side, key: keyof TeamStrength): number {
    const s = this.sides[side];
    const morale = 0.94 + (s.input.morale / 100) * 0.12;
    const home = side === 'home' ? HOME_BOOST : 1;
    const m = this.mods(side);
    const mod = key === 'attack' ? m.att : key === 'defense' ? m.def : key === 'midfield' ? m.mid : 1;
    const energy = 0.88 + (s.energy / 100) * 0.12;
    // Des joueurs à bout de souffle pèsent moins : un changement frais a un vrai effet.
    return s.strength[key] * morale * home * mod * energy * s.legs * (1 + (s.input.boost ?? 0) + s.talkBoost);
  }

  private playMinute(): void {
    const mh = Math.pow(this.power('home', 'midfield'), 3);
    const ma = Math.pow(this.power('away', 'midfield'), 3);
    const share = mh / (mh + ma);
    this.possessionAcc += share;

    const tempo = (this.mods('home').tempo + this.mods('away').tempo) / 2;
    const holder: Side = this.rng.chance(share) ? 'home' : 'away';
    this.act({ side: holder, kind: 'possession', playerId: this.visualPick(holder, (r) => ({ GK: 0.2, DEF: 2, MID: 3, ATT: 1 })[POSITION_GROUP[r]])?.id });
    if (this.rng.chance(ATTACK_RATE * tempo)) {
      const attacker: Side = this.rng.chance(0.15 + share * 0.7) ? 'home' : 'away';
      this.act({ side: attacker, kind: 'attack', zone: this.zoneFor(attacker), playerId: this.visualPick(attacker, (r) => ({ GK: 0, DEF: 0.4, MID: 2, ATT: 3 })[POSITION_GROUP[r]])?.id });
      this.attack(attacker);
    }
    for (const side of ['home', 'away'] as Side[]) {
      if (this.rng.chance(0.017 * this.mods(side).fouls)) this.foul(side);
    }
    for (const side of ['home', 'away'] as Side[]) {
      // Risque de blessure : fatigue des joueurs sur le terrain × entraînement du club.
      const fatigue = this.onPitch(side).reduce((sum, x) => sum + x.p.fatigue, 0) / 11;
      const risk = 0.0018 * (this.sides[side].input.injuryRisk ?? 1) * (0.6 + fatigue / 50);
      if (this.rng.chance(risk)) this.injury(side);
    }
  }

  private attack(att: Side, counter = false): void {
    const def: Side = att === 'home' ? 'away' : 'home';
    const a = Math.pow(this.power(att, 'attack'), 2.5);
    const d = Math.pow(this.power(def, 'defense'), 2.5);
    const raw = (a / (a + d)) * this.mods(att).shotQuality * this.mods(def).concede * (counter ? 1.12 : 1);
    const quality = Math.min(0.95, Math.max(0.05, raw));
    if (!this.rng.chance(0.3 + quality * 0.6)) {
      this.maybeCounter(def, counter);
      return; // l'action avorte
    }

    const S = this.sides[att];
    S.shots++;
    const shooter = this.pickShooter(att);
    if (!shooter) return;
    this.act({ side: att, kind: 'shot', playerId: shooter.id });

    if (!this.rng.chance(0.25 + quality * 0.25)) {
      this.act({ side: def, kind: 'miss', playerId: shooter.id, keeperId: this.keeperOf(def)?.id });
      if (this.rng.chance(0.25)) {
        this.push({ minute: this.minute, type: 'chance', side: att, playerId: shooter.id, text: line(this.rng, 'chance', { p: shortName(shooter), t: S.input.name }) });
      }
      this.maybeCounter(def, counter);
      return;
    }
    S.onTarget++;
    const ratio = this.power(att, 'attack') / this.power(def, 'goalkeeping');
    const goalProb = Math.min(0.6, Math.max(0.08, 0.23 * Math.pow(ratio, 2.2)));
    if (this.rng.chance(goalProb)) {
      this.goal(att, shooter);
    } else {
      this.bump(shooter.id, 0.05);
      const keeper = this.keeperOf(def);
      this.act({ side: def, kind: 'save', playerId: shooter.id, keeperId: keeper?.id });
      if (keeper) this.bump(keeper.id, 0.2);
      if (this.rng.chance(0.45)) {
        this.push({ minute: this.minute, type: 'save', side: att, playerId: shooter.id, text: line(this.rng, 'save', { p: shortName(shooter) }) });
      }
    }
  }

  /** Jeu de contre : une attaque adverse avortée peut déclencher une contre-attaque immédiate. */
  private maybeCounter(side: Side, alreadyCounter: boolean): void {
    if (alreadyCounter || !this.sides[side].instructions.counter || this.done) return;
    if (!this.rng.chance(0.22)) return;
    this.act({ side, kind: 'attack', counter: true, zone: this.zoneFor(side), playerId: this.visualPick(side, (r) => ({ GK: 0, DEF: 0.2, MID: 1.5, ATT: 4 })[POSITION_GROUP[r]])?.id });
    if (this.rng.chance(0.3)) this.push({ minute: this.minute, type: 'info', side, text: `Contre-attaque éclair de ${this.sides[side].input.name} !` });
    this.attack(side, true);
  }

  private goal(side: Side, scorer: Player): void {
    if (side === 'home') this.homeGoals++;
    else this.awayGoals++;
    const assist = this.rng.chance(0.75) ? this.pickAssist(side, scorer.id) : undefined;
    this.act({ side: side === 'home' ? 'away' : 'home', kind: 'goal', playerId: scorer.id, assistId: assist?.id });
    this.bump(scorer.id, 1);
    if (assist) this.bump(assist.id, 0.6);
    this.goalsLog.push({ playerId: scorer.id, assistId: assist?.id, side });
    let text = line(this.rng, 'goal', { p: shortName(scorer) });
    if (assist) text += line(this.rng, 'assist', { a: shortName(assist) });
    text += ` (${this.scoreText()})`;
    this.push({ minute: this.minute, type: 'goal', side, playerId: scorer.id, assistId: assist?.id, text });
  }

  private foul(side: Side): void {
    const s = this.sides[side];
    const offender = this.pickOnPitch(side, (p, role) => (POSITION_GROUP[role] === 'DEF' ? 3 : POSITION_GROUP[role] === 'MID' ? 2 : role === 'GK' ? 0.1 : 1));
    if (!offender) return;
    this.act({ side: side === 'home' ? 'away' : 'home', kind: 'foul', playerId: offender.id });
    if (this.rng.chance(0.04 * this.mods(side).redRisk)) {
      this.sendOff(side, offender, 'red');
      return;
    }
    if (s.yellows.has(offender.id)) {
      this.sendOff(side, offender, 'secondYellow');
      return;
    }
    s.yellows.add(offender.id);
    this.bump(offender.id, -0.3);
    this.push({ minute: this.minute, type: 'yellow', side, playerId: offender.id, text: line(this.rng, 'yellow', { p: shortName(offender) }) });
  }

  private sendOff(side: Side, p: Player, key: 'red' | 'secondYellow'): void {
    const s = this.sides[side];
    s.sentOff.add(p.id);
    const idx = s.lineup.indexOf(p.id);
    if (idx >= 0) s.lineup[idx] = null;
    this.bump(p.id, -1.5);
    this.refresh(side);
    this.push({ minute: this.minute, type: 'red', side, playerId: p.id, text: line(this.rng, key, { p: shortName(p), t: s.input.name }) });
  }

  private injury(side: Side): void {
    const s = this.sides[side];
    const victim = this.pickOnPitch(side, (p) => 1 + p.fatigue / 20);
    if (!victim || this.injuries[victim.id]) return;
    const injury = rollInjury(this.rng, victim.fatigue);
    this.injuries[victim.id] = injury;
    const idx = s.lineup.indexOf(victim.id);
    let text = `${line(this.rng, 'injury', { p: shortName(victim) })} Premier diagnostic : ${injury.name.toLowerCase()}.`;
    if (idx >= 0) {
      const role = s.roles[idx];
      const sub = s.subsUsed < MAX_SUBS ? this.benchOf(side).sort((x, y) => effectiveRating(y, role) - effectiveRating(x, role))[0] : undefined;
      s.subbedOff.add(victim.id);
      if (sub) {
        s.lineup[idx] = sub.id;
        s.bench = s.bench.filter((b) => b.id !== sub.id);
        s.subsUsed++;
        s.participants.add(sub.id);
        text += line(this.rng, 'sub', { a: shortName(sub) });
      } else {
        s.lineup[idx] = null;
      }
      this.refresh(side);
    }
    this.push({ minute: this.minute, type: 'injury', side, playerId: victim.id, text });
  }

  private finish(): void {
    this.done = true;
    if (!this.allowDraw && this.homeGoals === this.awayGoals) {
      this.penalties = this.shootout();
      const winner = this.penalties.home > this.penalties.away ? this.sides.home : this.sides.away;
      this.push({
        minute: 90,
        type: 'penalties',
        text: `Séance de tirs au but : ${this.penalties.home} – ${this.penalties.away}. ${winner.input.name} se qualifie !`,
      });
    }
    this.push({ minute: 90, type: 'fulltime', text: `Coup de sifflet final : ${this.scoreText()}.` });
  }

  private shootout(): { home: number; away: number } {
    let home = 0;
    let away = 0;
    const kick = (side: Side) => this.rng.chance(0.72 + (this.power(side, 'attack') - this.power(side === 'home' ? 'away' : 'home', 'goalkeeping')) * 0.004);
    for (let i = 0; i < 5; i++) {
      if (kick('home')) home++;
      if (kick('away')) away++;
    }
    while (home === away) {
      const h = kick('home');
      const a = kick('away');
      if (h) home++;
      if (a) away++;
    }
    return { home, away };
  }

  // ---------------------------------------------------------------- sélection de joueurs

  private onPitch(side: Side): { p: Player; role: Position }[] {
    const s = this.sides[side];
    const byId = s.byId;
    return s.lineup
      .map((id, i) => (id ? { p: byId.get(id)!, role: s.roles[i] } : null))
      .filter((x): x is { p: Player; role: Position } => !!x && !!x.p);
  }

  /** Enregistre une action de jeu pour l'animation. */
  private act(a: Omit<MatchAction, 'minute' | 'seq'>): void {
    this.lastAction = { ...a, minute: this.minute, seq: ++this.seq };
    this.minuteActions.push(this.lastAction);
  }

  /** Joueur choisi pour l'animation (tirage visuel, sans effet sur le match). */
  private visualPick(side: Side, weight: (role: Position) => number): Player | undefined {
    const list = this.onPitch(side);
    return list.length ? this.vis.weighted(list, (x) => weight(x.role) + 0.01).p : undefined;
  }

  private zoneFor(side: Side): 'left' | 'center' | 'right' {
    const focus = this.sides[side].instructions.focus;
    if (focus === 'flanks') return this.vis.chance(0.5) ? 'left' : 'right';
    if (focus === 'center') return this.vis.chance(0.75) ? 'center' : this.vis.chance(0.5) ? 'left' : 'right';
    return this.vis.pick(['left', 'center', 'right'] as const);
  }

  private pickOnPitch(side: Side, weight: (p: Player, role: Position) => number): Player | undefined {
    const list = this.onPitch(side);
    if (!list.length) return undefined;
    return this.rng.weighted(list, (x) => weight(x.p, x.role)).p;
  }

  private pickShooter(side: Side): Player | undefined {
    return this.pickOnPitch(side, (p, role) => {
      const base = { GK: 0, DEF: 0.6, MID: 2, ATT: 6 }[POSITION_GROUP[role]] + (role === 'AM' ? 2 : 0);
      return base * Math.pow((p.rating * positionFit(p.position, role)) / 70, 2);
    });
  }

  private pickAssist(side: Side, scorerId: string): Player | undefined {
    const list = this.onPitch(side).filter((x) => x.p.id !== scorerId);
    if (!list.length) return undefined;
    return this.rng.weighted(list, (x) => ({ GK: 0.05, DEF: 1, MID: 4, ATT: 3 })[POSITION_GROUP[x.role]] * (x.p.rating / 70)).p;
  }

  private keeperOf(side: Side): Player | undefined {
    return this.onPitch(side).find((x) => x.role === 'GK')?.p;
  }

  private bump(playerId: string, delta: number): void {
    this.ratingAdj.set(playerId, (this.ratingAdj.get(playerId) ?? 0) + delta);
  }

  private computeRatings(): Record<string, number> {
    const out: Record<string, number> = {};
    (['home', 'away'] as Side[]).forEach((side) => {
      const s = this.sides[side];
      const scored = side === 'home' ? this.homeGoals : this.awayGoals;
      const conceded = side === 'home' ? this.awayGoals : this.homeGoals;
      const resultBonus = scored > conceded ? 0.4 : scored < conceded ? -0.4 : 0;
      const byId = new Map(s.input.squad.map((p) => [p.id, p]));
      s.participants.forEach((id) => {
        const p = byId.get(id);
        if (!p) return;
        const group = POSITION_GROUP[p.position];
        let r = 6.2 + resultBonus + (this.ratingAdj.get(id) ?? 0) + (this.rng.next() - 0.5) * 0.8;
        if (group === 'GK' || group === 'DEF') r += conceded === 0 ? 0.6 : -0.25 * conceded;
        r += (p.rating - 70) * 0.02;
        out[id] = Math.round(Math.min(10, Math.max(3, r)) * 10) / 10;
      });
    });
    return out;
  }

  private push(e: MatchEvent): void {
    this.events.push(e);
  }

  private scoreText(): string {
    return `${this.sides.home.input.name} ${this.homeGoals} – ${this.awayGoals} ${this.sides.away.input.name}`;
  }
}

function shortName(p: Player): string {
  return `${p.firstName.charAt(0)}. ${p.lastName}`;
}

function styleText(style: TeamStyle): string {
  return STYLE_LABELS[style].toLowerCase();
}

