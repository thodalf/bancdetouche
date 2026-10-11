export type CompetitionId = 'league' | 'cup';

export type MatchEventType =
  | 'kickoff'
  | 'goal'
  | 'chance'
  | 'save'
  | 'yellow'
  | 'red'
  | 'injury'
  | 'halftime'
  | 'fulltime'
  | 'penalties'
  | 'info';

export interface MatchEvent {
  minute: number;
  type: MatchEventType;
  /** 'home' | 'away' quand l'événement concerne une équipe. */
  side?: 'home' | 'away';
  playerId?: string;
  assistId?: string;
  text: string;
}

export interface MatchStats {
  possessionHome: number;
  shotsHome: number;
  shotsAway: number;
  onTargetHome: number;
  onTargetAway: number;
}

export interface Fixture {
  id: string;
  competition: CompetitionId;
  /** Index de la semaine dans le calendrier de la saison. */
  week: number;
  homeId: string;
  awayId: string;
  played: boolean;
  homeGoals: number;
  awayGoals: number;
  /** Coupe nationale (code du pays) pour un match de coupe. */
  cup?: string;
  /** Tirs au but en coupe si match nul. */
  penalties?: { home: number; away: number };
  events: MatchEvent[];
  stats?: MatchStats;
  /** Notes des joueurs ayant joué (playerId -> note sur 10). */
  ratings?: Record<string, number>;
}

export interface SeasonWeek {
  index: number;
  /** Date ISO (samedi du week-end de match). */
  date: string;
  competition: CompetitionId;
  /** Journée de championnat (1..n) ou tour de coupe (0..n). */
  round: number;
  label: string;
}

export interface StandingRow {
  clubId: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
  /** 5 derniers résultats, du plus ancien au plus récent. */
  form: ('W' | 'D' | 'L')[];
}

/** Tours de coupe : la coupe de France (32 clubs) commence en seizièmes, les autres (16 clubs) en huitièmes. */
export const CUP_ROUND_LABELS = ['Seizièmes de finale', 'Huitièmes de finale', 'Quarts de finale', 'Demi-finales', 'Finale'];
export const CUP_FINAL_ROUND = CUP_ROUND_LABELS.length - 1;
