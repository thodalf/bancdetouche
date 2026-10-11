import { Position } from './player.model';

export type FormationId = '4-3-3' | '4-4-2' | '3-5-2' | '4-2-3-1' | '5-3-2';
export type TeamStyle = 'ultraDefensive' | 'defensive' | 'balanced' | 'attacking' | 'ultraAttacking';

export type Pressing = 'low' | 'medium' | 'high';
export type DefensiveLine = 'deep' | 'standard' | 'high';
export type PassingStyle = 'short' | 'mixed' | 'direct';
export type Width = 'narrow' | 'normal' | 'wide';
export type Tackling = 'cautious' | 'normal' | 'hard';
export type Tempo = 'slow' | 'normal' | 'fast';
export type AttackFocus = 'flanks' | 'mixed' | 'center';
export type Marking = 'zonal' | 'man';
export type Shooting = 'patient' | 'normal' | 'long';
export type SetPieces = 'short' | 'mixed' | 'aerial';
export type Distribution = 'short' | 'mixed' | 'long';

/** Consignes collectives : elles modulent le moteur de match et peuvent changer en direct. */
export interface TeamInstructions {
  pressing: Pressing;
  line: DefensiveLine;
  passing: PassingStyle;
  width: Width;
  tackling: Tackling;
  /** Rythme de la circulation du ballon. */
  tempo: Tempo;
  /** Couloir d'attaque privilégié. */
  focus: AttackFocus;
  marking: Marking;
  /** Choix de tir : attendre l'occasion nette ou frapper de loin. */
  shooting: Shooting;
  setPieces: SetPieces;
  /** Relance du gardien. */
  distribution: Distribution;
  /** Piège du hors-jeu (efficace avec une ligne haute, dangereux contre le jeu direct). */
  offsideTrap: boolean;
  /** Jouer en contre : chaque attaque adverse ratée peut déclencher une contre-attaque. */
  counter: boolean;
  /** Gagner du temps quand on mène : rythme ralenti, risque de carton. */
  timeWasting: boolean;
}

export const DEFAULT_INSTRUCTIONS: TeamInstructions = {
  pressing: 'medium',
  line: 'standard',
  passing: 'mixed',
  width: 'normal',
  tackling: 'normal',
  tempo: 'normal',
  focus: 'mixed',
  marking: 'zonal',
  shooting: 'normal',
  setPieces: 'mixed',
  distribution: 'mixed',
  offsideTrap: false,
  counter: false,
  timeWasting: false,
};

/** Libellés des options de consignes, dans l'ordre d'affichage. */
export const INSTRUCTION_OPTIONS = {
  pressing: [
    ['low', 'Bas'],
    ['medium', 'Moyen'],
    ['high', 'Haut'],
  ],
  line: [
    ['deep', 'Basse'],
    ['standard', 'Médiane'],
    ['high', 'Haute'],
  ],
  passing: [
    ['short', 'Courtes'],
    ['mixed', 'Mixtes'],
    ['direct', 'Directes'],
  ],
  width: [
    ['narrow', 'Étroite'],
    ['normal', 'Normale'],
    ['wide', 'Large'],
  ],
  tackling: [
    ['cautious', 'Prudent'],
    ['normal', 'Normal'],
    ['hard', 'Rugueux'],
  ],
  tempo: [
    ['slow', 'Lent'],
    ['normal', 'Normal'],
    ['fast', 'Rapide'],
  ],
  focus: [
    ['flanks', 'Ailes'],
    ['mixed', 'Variée'],
    ['center', 'Axe'],
  ],
  marking: [
    ['zonal', 'Zone'],
    ['man', 'Individuel'],
  ],
  shooting: [
    ['patient', 'Patient'],
    ['normal', 'Normal'],
    ['long', 'De loin'],
  ],
  setPieces: [
    ['short', 'Courts'],
    ['mixed', 'Variés'],
    ['aerial', 'Jeu aérien'],
  ],
  distribution: [
    ['short', 'Courte'],
    ['mixed', 'Variée'],
    ['long', 'Longue'],
  ],
} as const;

/** Familles de consignes, dans l'ordre d'affichage de la page Tactique. */
export const INSTRUCTION_GROUPS: { id: string; label: string; description: string; keys: (keyof TeamInstructions)[] }[] = [
  { id: 'possession', label: 'Avec le ballon', description: 'Comment construire et finir les actions.', keys: ['passing', 'tempo', 'width', 'focus', 'shooting'] },
  { id: 'defense', label: 'Sans le ballon', description: 'Où et comment récupérer le ballon.', keys: ['pressing', 'line', 'marking', 'tackling', 'offsideTrap'] },
  { id: 'transition', label: 'Transitions', description: 'Les secondes qui suivent un changement de possession.', keys: ['counter', 'distribution', 'timeWasting'] },
  { id: 'setPieces', label: 'Coups de pied arrêtés', description: 'Corners et coups francs.', keys: ['setPieces'] },
];

/** Explication de chaque option, affichée sous la consigne choisie. */
export const INSTRUCTION_HINTS: Record<string, string> = {
  'pressing.low': 'Bloc patient : moins de fautes et d’efforts, mais l’adversaire a le ballon.',
  'pressing.medium': 'Pression mesurée au milieu de terrain.',
  'pressing.high': 'Récupère le ballon très haut. Épuisant et risqué si l’adversaire relance court.',
  'line.deep': 'Surface protégée, mais l’équipe recule et subit.',
  'line.standard': 'Ligne médiane, sans risque particulier.',
  'line.high': 'Bloc compact et étouffant, mais espaces dans le dos des défenseurs.',
  'passing.short': 'Possession et occasions plus nettes, rythme plus lent.',
  'passing.mixed': 'Mélange de jeu court et de ballons longs.',
  'passing.direct': 'Plus d’attaques, mais moins précises. Idéal pour les contres.',
  'width.narrow': 'Ferme l’axe et protège la défense, moins de danger sur les côtés.',
  'width.normal': 'Occupation équilibrée de la largeur.',
  'width.wide': 'Étire l’adversaire, utile contre un bloc resserré.',
  'tackling.cautious': 'Moins de cartons, mais l’adversaire passe plus facilement.',
  'tackling.normal': 'Engagement normal.',
  'tackling.hard': 'Gêne l’adversaire, mais cartons en série.',
  'tempo.slow': 'On endort le match : moins d’attaques, plus de maîtrise, moins de fatigue.',
  'tempo.normal': 'Rythme naturel de l’équipe.',
  'tempo.fast': 'Plus d’attaques et d’intensité, au prix de la précision et de l’endurance.',
  'focus.flanks': 'Attaques par les côtés : redoutable contre une équipe qui ferme l’axe.',
  'focus.mixed': 'Aucun couloir privilégié.',
  'focus.center': 'Attaques dans l’axe : occasions nettes contre une équipe trop étirée.',
  'marking.zonal': 'Chacun sa zone : solide et économe.',
  'marking.man': 'Marquage individuel : étouffe le jeu direct, mais fatigue et provoque des fautes.',
  'shooting.patient': 'On attend l’occasion nette : moins de tirs, mieux cadrés.',
  'shooting.normal': 'Tirs selon les occasions.',
  'shooting.long': 'Frappes de loin : plus de tirs, moins dangereux.',
  'setPieces.short': 'Combinaisons courtes : conservation du ballon.',
  'setPieces.mixed': 'Coups de pied arrêtés variés.',
  'setPieces.aerial': 'Ballons dans la surface : occasions supplémentaires, jeu plus haché.',
  'distribution.short': 'Relance courte : meilleure possession, risquée contre un pressing haut.',
  'distribution.mixed': 'Le gardien choisit selon la situation.',
  'distribution.long': 'Dégagements longs : pas de risque à la relance, possession plus faible.',
  'offsideTrap.true': 'Les attaquants sont souvent pris au piège avec une ligne haute… sauf contre le jeu direct ou les contres.',
  'offsideTrap.false': 'Pas de piège du hors-jeu.',
  'counter.true': 'Chaque attaque adverse ratée peut déclencher une contre-attaque.',
  'counter.false': 'Pas de projection systématique vers l’avant.',
  'timeWasting.true': 'Quand vous menez : le rythme ralentit, gare aux cartons.',
  'timeWasting.false': 'Jeu normal quel que soit le score.',
};

/** Situations de match qui peuvent déclencher automatiquement un plan de jeu. */
export type ScenarioTrigger = 'downToTen' | 'upAgainstTen' | 'trailing' | 'leading' | 'drawing' | 'tired';

export interface ScenarioRule {
  /** Identifiant d'un plan de jeu (GAME_PLANS). */
  plan: string;
  /** Minute à partir de laquelle la règle s'applique. */
  from: number;
}

export const SCENARIO_TRIGGERS: { id: ScenarioTrigger; label: string; description: string }[] = [
  { id: 'downToTen', label: 'Réduits à dix', description: 'Vous avez plus d’expulsés que l’adversaire.' },
  { id: 'upAgainstTen', label: 'Adversaire réduit', description: 'L’adversaire a plus d’expulsés que vous.' },
  { id: 'trailing', label: 'Menés au score', description: 'Vous perdez le match.' },
  { id: 'leading', label: 'Devant au score', description: 'Vous gagnez le match.' },
  { id: 'drawing', label: 'Score de parité', description: 'Le match est nul.' },
  { id: 'tired', label: 'Équipe fatiguée', description: 'L’endurance collective passe sous 55 %.' },
];

export const INSTRUCTION_LABELS: Record<keyof TeamInstructions, string> = {
  pressing: 'Pressing',
  line: 'Ligne défensive',
  passing: 'Passes',
  width: 'Largeur',
  tackling: 'Engagement',
  counter: 'Jeu de contre',
  timeWasting: 'Gagner du temps',
  tempo: 'Rythme',
  focus: 'Couloir d’attaque',
  marking: 'Marquage',
  shooting: 'Choix de tir',
  setPieces: 'Coups de pied arrêtés',
  distribution: 'Relance du gardien',
  offsideTrap: 'Piège du hors-jeu',
};

export interface FormationSlot {
  role: Position;
  /** Coordonnées sur le terrain en %, x de gauche à droite, y du but adverse (0) à son propre but (100). */
  x: number;
  y: number;
}

export interface Formation {
  id: FormationId;
  slots: FormationSlot[];
}

export interface Tactic {
  formation: FormationId;
  style: TeamStyle;
  instructions: TeamInstructions;
  /** Positions personnalisées (glisser-déposer sur le terrain), sinon celles de la formation. */
  slots?: FormationSlot[];
  /** Plans de jeu appliqués automatiquement en match selon le scénario (dans l'ordre de SCENARIO_TRIGGERS). */
  scenarios?: Partial<Record<ScenarioTrigger, ScenarioRule>>;
  /** Un id de joueur par poste de la formation (même index que slots), null si vide. */
  lineup: (string | null)[];
}

export const STYLE_LABELS: Record<TeamStyle, string> = {
  ultraDefensive: 'Très défensif',
  defensive: 'Défensif',
  balanced: 'Équilibré',
  attacking: 'Offensif',
  ultraAttacking: 'Tout pour l\'attaque',
};

export const STYLE_ORDER: TeamStyle[] = ['ultraDefensive', 'defensive', 'balanced', 'attacking', 'ultraAttacking'];

export const FORMATIONS: Record<FormationId, Formation> = {
  '4-3-3': {
    id: '4-3-3',
    slots: [
      { role: 'GK', x: 50, y: 92 },
      { role: 'LB', x: 15, y: 72 },
      { role: 'CB', x: 38, y: 76 },
      { role: 'CB', x: 62, y: 76 },
      { role: 'RB', x: 85, y: 72 },
      { role: 'CM', x: 30, y: 50 },
      { role: 'DM', x: 50, y: 58 },
      { role: 'CM', x: 70, y: 50 },
      { role: 'LW', x: 18, y: 24 },
      { role: 'ST', x: 50, y: 16 },
      { role: 'RW', x: 82, y: 24 },
    ],
  },
  '4-4-2': {
    id: '4-4-2',
    slots: [
      { role: 'GK', x: 50, y: 92 },
      { role: 'LB', x: 15, y: 72 },
      { role: 'CB', x: 38, y: 76 },
      { role: 'CB', x: 62, y: 76 },
      { role: 'RB', x: 85, y: 72 },
      { role: 'LM', x: 15, y: 46 },
      { role: 'CM', x: 38, y: 50 },
      { role: 'CM', x: 62, y: 50 },
      { role: 'RM', x: 85, y: 46 },
      { role: 'ST', x: 38, y: 18 },
      { role: 'ST', x: 62, y: 18 },
    ],
  },
  '3-5-2': {
    id: '3-5-2',
    slots: [
      { role: 'GK', x: 50, y: 92 },
      { role: 'CB', x: 28, y: 76 },
      { role: 'CB', x: 50, y: 78 },
      { role: 'CB', x: 72, y: 76 },
      { role: 'LM', x: 10, y: 48 },
      { role: 'CM', x: 34, y: 46 },
      { role: 'DM', x: 50, y: 58 },
      { role: 'CM', x: 66, y: 46 },
      { role: 'RM', x: 90, y: 48 },
      { role: 'ST', x: 38, y: 18 },
      { role: 'ST', x: 62, y: 18 },
    ],
  },
  '4-2-3-1': {
    id: '4-2-3-1',
    slots: [
      { role: 'GK', x: 50, y: 92 },
      { role: 'LB', x: 15, y: 72 },
      { role: 'CB', x: 38, y: 76 },
      { role: 'CB', x: 62, y: 76 },
      { role: 'RB', x: 85, y: 72 },
      { role: 'DM', x: 38, y: 58 },
      { role: 'DM', x: 62, y: 58 },
      { role: 'LW', x: 18, y: 34 },
      { role: 'AM', x: 50, y: 36 },
      { role: 'RW', x: 82, y: 34 },
      { role: 'ST', x: 50, y: 15 },
    ],
  },
  '5-3-2': {
    id: '5-3-2',
    slots: [
      { role: 'GK', x: 50, y: 92 },
      { role: 'LB', x: 10, y: 64 },
      { role: 'CB', x: 30, y: 76 },
      { role: 'CB', x: 50, y: 78 },
      { role: 'CB', x: 70, y: 76 },
      { role: 'RB', x: 90, y: 64 },
      { role: 'CM', x: 30, y: 46 },
      { role: 'CM', x: 50, y: 50 },
      { role: 'CM', x: 70, y: 46 },
      { role: 'ST', x: 38, y: 18 },
      { role: 'ST', x: 62, y: 18 },
    ],
  },
};

export const FORMATION_IDS = Object.keys(FORMATIONS) as FormationId[];

/** Postes effectifs d'une tactique : positions personnalisées ou celles de la formation. */
export function tacticSlots(t: Pick<Tactic, 'formation' | 'slots'>): FormationSlot[] {
  return t.slots && t.slots.length === FORMATIONS[t.formation].slots.length ? t.slots : FORMATIONS[t.formation].slots;
}

/**
 * Poste déduit d'une position sur le terrain (x : gauche → droite, y : but adverse → son but).
 * Utilisé quand l'entraîneur déplace un joueur à la souris.
 */
export function roleForPosition(x: number, y: number): Position {
  const side = x < 30 ? 'L' : x > 70 ? 'R' : 'C';
  if (y >= 66) return side === 'L' ? 'LB' : side === 'R' ? 'RB' : 'CB';
  if (y >= 56) return side === 'C' ? 'DM' : side === 'L' ? 'LM' : 'RM';
  if (y >= 40) return side === 'C' ? 'CM' : side === 'L' ? 'LM' : 'RM';
  if (y >= 26) return side === 'C' ? 'AM' : side === 'L' ? 'LW' : 'RW';
  return side === 'C' ? 'ST' : side === 'L' ? 'LW' : 'RW';
}
