import { Player } from './player.model';
import { FormationId, Tactic, TeamInstructions, TeamStyle } from './tactics.model';

/** Données d'une équipe pour le moteur de match (copie figée au coup d'envoi). */
export interface SideInput {
  clubId: string;
  name: string;
  /** Tactique avec un onze complet (voir repairLineup). */
  tactic: Tactic;
  /** Effectif complet (titulaires + remplaçants). */
  squad: Player[];
  morale: number;
  /** Multiplicateur de risque de blessure (entraînement, infrastructures). */
  injuryRisk?: number;
  /** Équipe gérée par l'IA : elle effectue elle-même ses remplacements. */
  aiControlled?: boolean;
  /** Bonus de force (staff, avantages, événements). */
  boost?: number;
  /** Endurance supplémentaire rendue par chaque remplacement. */
  subEnergy?: number;
}

/** Décision de l'entraîneur pendant le match, rejouable à l'identique. */
export type LiveCommand = { minute: number } & (
  | { kind: 'style'; style: TeamStyle }
  | { kind: 'sub'; outId: string; inId: string }
  | { kind: 'formation'; formation: FormationId }
  | { kind: 'instructions'; instructions: Partial<TeamInstructions>; style?: TeamStyle; label?: string }
  | { kind: 'talk'; tone: TeamTalkTone }
);

/** Ton de la causerie de mi-temps. */
export type TeamTalkTone = 'calm' | 'encourage' | 'angry' | 'focus';

/**
 * Match en direct en cours. Le moteur étant déterministe (graine + décisions horodatées),
 * on peut le reconstruire à l'identique après un changement de page ou un rechargement.
 */
export interface LiveMatchState {
  fixtureId: string;
  seed: number;
  home: SideInput;
  away: SideInput;
  allowDraw: boolean;
  userSide: 'home' | 'away';
  commands: LiveCommand[];
  /** Dernière minute sauvegardée (le direct reprend à partir d'ici). */
  minute: number;
  /** Mode « résultat immédiat » : le match est déjà joué jusqu'au bout. */
  instant: boolean;
}
