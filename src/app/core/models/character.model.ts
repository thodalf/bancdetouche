/** Postes du staff (le « conseil » de l'entraîneur). */
export type StaffRole = 'assistant' | 'fitness' | 'doctor' | 'scout' | 'youth' | 'director';

export type TraitId =
  | 'charismatic'
  | 'perfectionist'
  | 'lazy'
  | 'ambitious'
  | 'loyal'
  | 'greedy'
  | 'diplomat'
  | 'visionary'
  | 'globetrotter'
  | 'meticulous'
  | 'hothead'
  | 'veteran'
  | 'innovator';

/** Caractéristiques de jeu que les personnages, avantages et événements peuvent modifier. */
export type EffectKey =
  | 'matchStrength'
  | 'subEnergy'
  | 'recovery'
  | 'injuryRisk'
  | 'injuryDuration'
  | 'scoutSpeed'
  | 'scoutAccuracy'
  | 'boosterQuality'
  | 'youthGrowth'
  | 'youthPotential'
  | 'intakeSize'
  | 'wageDemands'
  | 'salePrice'
  | 'feeDiscount'
  | 'negotiationRounds'
  | 'morale'
  | 'boardConfidence'
  | 'income'
  | 'upkeep';

export type Effects = Partial<Record<EffectKey, number>>;

export interface StaffMember {
  id: string;
  firstName: string;
  lastName: string;
  nationality: string;
  age: number;
  role: StaffRole;
  /** Compétence 1-20. */
  skill: number;
  traits: TraitId[];
  /** Opinion de l'entraîneur 0-100 : un membre démotivé rend moins et peut démissionner. */
  opinion: number;
  wage: number;
  contractYears: number;
  /** Mission de recrutement en cours (recruteurs). */
  missionId: string | null;
}

export type LifestyleId = 'tactician' | 'mentor' | 'negotiator' | 'leader' | 'steward';

export type MissionFocus = 'balanced' | 'youth' | 'experienced' | 'bargain' | 'GK' | 'DEF' | 'MID' | 'ATT';

export interface ScoutMission {
  id: string;
  staffId: string;
  focus: MissionFocus;
  weeks: number;
  weeksLeft: number;
  cost: number;
}

/** Événement à choix en attente de décision. */
export interface PendingEvent {
  id: string;
  defId: string;
  staffId?: string;
  staff2Id?: string;
  playerId?: string;
  player2Id?: string;
  clubId?: string;
  season: number;
  week: number;
}

/** Effet temporaire (issu d'un événement). */
/** Suite d'un événement, programmée pour plus tard (chaînes d'événements). */
export interface QueuedEvent {
  defId: string;
  staffId?: string;
  playerId?: string;
  player2Id?: string;
  clubId?: string;
  /** Horodatage (saison * 100 + semaine) à partir duquel la suite peut survenir. */
  due: number;
}

export interface Modifier {
  id: string;
  label: string;
  effects: Effects;
  weeksLeft: number;
}

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  assistant: 'Entraîneur adjoint',
  fitness: 'Préparateur physique',
  doctor: 'Médecin',
  scout: 'Recruteur',
  youth: 'Responsable de la formation',
  director: 'Directeur sportif',
};

export const MISSION_FOCUS_LABELS: Record<MissionFocus, string> = {
  balanced: 'Profil polyvalent',
  youth: 'Jeunes talents',
  experienced: 'Joueurs confirmés',
  bargain: 'Bonnes affaires',
  GK: 'Gardiens',
  DEF: 'Défenseurs',
  MID: 'Milieux',
  ATT: 'Attaquants',
};
