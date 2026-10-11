import { Club } from './club.model';
import { Fixture, SeasonWeek } from './competition.model';
import { Player, SquadStatus } from './player.model';
import { LiveMatchState } from './match.model';
import { BoosterState, PackOpening } from './booster.model';
import { LifestyleId, Modifier, PendingEvent, QueuedEvent, ScoutMission, StaffMember } from './character.model';
import { WeekPlan } from './week.model';

export type NewsKind = 'board' | 'transfer' | 'match' | 'finance' | 'injury' | 'season' | 'youth' | 'scouting' | 'career' | 'squad' | 'booster' | 'staff' | 'event';

export interface NewsItem {
  id: string;
  week: number;
  season: number;
  kind: NewsKind;
  title: string;
  body: string;
  read: boolean;
}

export type FinanceCategory =
  | 'wages'
  | 'gate'
  | 'tv'
  | 'sponsor'
  | 'transferIn'
  | 'transferOut'
  | 'prize'
  | 'severance'
  | 'bonus'
  | 'facilities'
  | 'booster'
  | 'staff';

export interface FinanceEntry {
  season: number;
  week: number;
  /** Club concerné (l'entraîneur peut changer de club en cours de carrière). */
  clubId: string;
  category: FinanceCategory;
  /** Positif = recette, négatif = dépense. */
  amount: number;
  label: string;
}

export type OfferStatus = 'pending' | 'accepted' | 'rejected' | 'expired';

/** Offre d'un club IA pour un joueur du club de l'utilisateur. */
export interface IncomingOffer {
  id: string;
  playerId: string;
  fromClubId: string;
  amount: number;
  week: number;
  status: OfferStatus;
}

/** Indemnité de transfert acceptée par le club vendeur : il reste à convaincre le joueur. */
export interface FeeAgreement {
  playerId: string;
  fee: number;
  /** Horodatage d'expiration (voir nowStamp). */
  expires: number;
}

/** Conditions d'un contrat proposé à un joueur. */
export interface ContractOffer {
  wage: number;
  years: number;
  signingBonus: number;
  releaseClause: number | null;
  status: SquadStatus;
}

export interface SeasonRecord {
  season: number;
  championId: string;
  cupWinnerId: string | null;
  userPosition: number;
  userClubId: string;
}

// ------------------------------------------------------------------ direction

export type ObjectiveKind = 'league' | 'cup' | 'finance' | 'wages' | 'youth';
export type ObjectiveImportance = 'low' | 'medium' | 'high';
export type ObjectiveStatus = 'achieved' | 'on-track' | 'at-risk' | 'failed';

export interface BoardObjective {
  kind: ObjectiveKind;
  label: string;
  /** Valeur cible : place au classement, tour de coupe, trésorerie minimale, nombre de jeunes… */
  target: number;
  importance: ObjectiveImportance;
}

export interface BoardReview {
  season: number;
  week: number;
  confidence: number;
  text: string;
}

export interface BoardState {
  /** Confiance de la direction 0-100. Sous le seuil, l'entraîneur est limogé. */
  confidence: number;
  objectives: BoardObjective[];
  /** Trésorerie au début du mandat sur la saison (objectif financier). */
  startBalance: number;
  reviews: BoardReview[];
}

// ------------------------------------------------------------------ carrière

export interface CareerEntry {
  clubId: string;
  fromSeason: number;
  fromWeek: number;
  toSeason?: number;
  toWeek?: number;
  /** Motif du départ. */
  exit?: 'sacked' | 'left';
}

export interface ManagerState {
  name: string;
  /** Réputation 0-100 : détermine quels clubs s'intéressent à l'entraîneur. */
  reputation: number;
  career: CareerEntry[];
  trophies: { season: number; title: string; clubId: string }[];
  /** Sans club après un limogeage : il faut accepter une offre pour continuer. */
  unemployed: boolean;
  /** Expérience et niveau d'entraîneur (débloquent les boosters). */
  xp: number;
  level: number;
  /** Mode de vie choisi (arbre d'avantages, façon Crusader Kings). */
  lifestyle: LifestyleId | null;
  perks: string[];
  perkPoints: number;
}

export interface JobOffer {
  id: string;
  clubId: string;
  expires: number;
  status: OfferStatus;
}

export interface ScoutingState {
  /** Connaissance de chaque joueur observé, 0-100 (100 = notes exactes). */
  knowledge: Record<string, number>;
  /** Joueurs en cours d'observation. */
  assignments: string[];
}

export interface GameState {
  /** Version du schéma de sauvegarde, pour migrer les anciennes parties. */
  schemaVersion: number;
  createdAt: string;
  savedAt: string | null;
  managerName: string;
  userClubId: string;
  season: number;
  /** Semaine courante (index dans weeks). weeks.length = saison terminée. */
  currentWeek: number;
  /** Graine du générateur aléatoire, avancée à chaque tirage. */
  rngSeed: number;
  clubs: Club[];
  players: Player[];
  weeks: SeasonWeek[];
  fixtures: Fixture[];
  news: NewsItem[];
  ledger: FinanceEntry[];
  offers: IncomingOffer[];
  feeAgreements: FeeAgreement[];
  /** Nombre de tours de négociation déjà menés par joueur. */
  negotiations: Record<string, number>;
  history: SeasonRecord[];
  board: BoardState;
  manager: ManagerState;
  jobOffers: JobOffer[];
  scouting: ScoutingState;
  /** Match en direct non terminé (survit aux changements de page et aux rechargements). */
  liveMatch: LiveMatchState | null;
  boosters: BoosterState;
  /** Booster ouvert dont le joueur n'a pas encore été choisi. */
  pendingPack: PackOpening | null;
  /** Staff du club de l'entraîneur et candidats disponibles. */
  staff: StaffMember[];
  staffMarket: StaffMember[];
  missions: ScoutMission[];
  events: PendingEvent[];
  /** Suites d'événements programmées. */
  eventQueue?: QueuedEvent[];
  /** Semaine de travail en cours (entraînement, préparation, entretiens, presse). */
  weekPlan?: WeekPlan;
  modifiers: Modifier[];
  nextId: number;
}

export const SCHEMA_VERSION = 6;
