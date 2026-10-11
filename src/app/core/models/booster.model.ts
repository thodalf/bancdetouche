import { Player } from './player.model';

export type BoosterTier = 'bronze' | 'silver' | 'gold' | 'elite';
export type CardRarity = 'common' | 'rare' | 'epic' | 'legendary';

import { MissionFocus } from './character.model';

/** Booster rapporté par un recruteur, en attente d'ouverture. */
export interface BoosterItem {
  id: string;
  tier: BoosterTier;
  focus: MissionFocus;
  scoutName: string;
  /** Compétence du recruteur : fiabilité des rapports sur les cartes. */
  scoutSkill: number;
}

export interface BoosterState {
  items: BoosterItem[];
  opened: number;
}

export interface PackOpening {
  id: string;
  tier: BoosterTier;
  scoutName: string;
  /** Joueurs générés pour ce booster (hors effectif tant qu'aucun n'est choisi). */
  cards: Player[];
}

export const BOOSTER_LABELS: Record<BoosterTier, string> = {
  bronze: 'Bronze',
  silver: 'Argent',
  gold: 'Or',
  elite: 'Élite',
};

export const RARITY_LABELS: Record<CardRarity, string> = {
  common: 'Commune',
  rare: 'Rare',
  epic: 'Épique',
  legendary: 'Légendaire',
};
