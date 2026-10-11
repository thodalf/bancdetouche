import { Tactic } from './tactics.model';

export interface ClubColors {
  primary: string;
  secondary: string;
}

export type FacilityKind = 'stadium' | 'training' | 'academy' | 'scouting';
export type TrainingIntensity = 'light' | 'normal' | 'intense';

/** Niveaux 1 à 5 de chaque infrastructure. */
export type Facilities = Record<FacilityKind, number>;

export interface Construction {
  kind: FacilityKind;
  targetLevel: number;
  weeksLeft: number;
}

export const FACILITY_LABELS: Record<FacilityKind, string> = {
  stadium: 'Stade',
  training: "Centre d'entraînement",
  academy: 'Centre de formation',
  scouting: 'Cellule de recrutement',
};

export const TRAINING_LABELS: Record<TrainingIntensity, string> = {
  light: 'Léger',
  normal: 'Normal',
  intense: 'Intensif',
};

export interface Club {
  id: string;
  name: string;
  shortName: string;
  city: string;
  colors: ClubColors;
  stadium: string;
  capacity: number;
  /** Réputation 1-100 : influence les recettes, l'affluence et l'attrait pour les joueurs. */
  reputation: number;
  /** Niveau sportif 1-5 étoiles (affichage, génération de l'effectif). */
  level: number;
  /** Trésorerie du club. */
  balance: number;
  /** Enveloppe allouée par la direction aux transferts. */
  transferBudget: number;
  /** Masse salariale hebdomadaire maximale autorisée. */
  wageBudget: number;
  ticketPrice: number;
  /** Moral collectif 0-100. */
  morale: number;
  tactic: Tactic;
  facilities: Facilities;
  construction: Construction | null;
  trainingIntensity: TrainingIntensity;
}
