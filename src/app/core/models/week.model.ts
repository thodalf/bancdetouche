/** Séance d'entraînement d'une journée de la semaine. */
export type SessionType = 'tactical' | 'physical' | 'technical' | 'setPieces' | 'recovery' | 'rest';

/** Approche d'un entretien individuel. */
export type TalkApproach = 'praise' | 'demand' | 'promise' | 'support';

/** Semaine de travail entre deux matchs : entraînement, préparation, entretiens, presse. */
export interface WeekPlan {
  season: number;
  week: number;
  /** Une séance par jour, du lundi au vendredi. */
  sessions: SessionType[];
  /** Plan de préparation choisi contre le prochain adversaire. */
  prep: string | null;
  talks: { playerId: string; approach: TalkApproach; text: string; delta: number }[];
  /** Questions de la conférence de presse (tirées une fois pour la semaine). */
  pressIds: string[];
  /** Réponse choisie à chaque question (null = pas encore répondu). */
  press: (number | null)[];
}

export const SESSION_INFO: Record<SessionType, { label: string; short: string; description: string }> = {
  tactical: { label: 'Tactique', short: 'TAC', description: 'Automatismes et mise en place : force en match +0,6 % par séance (max. 3), fatigue +2.' },
  physical: { label: 'Physique', short: 'PHY', description: 'Foncier : risque de blessure −4 % et force +0,3 % par séance, mais fatigue +5.' },
  technical: { label: 'Technique', short: 'TEC', description: 'Gestes et jeu court : chaque jeune de 23 ans ou moins a 5 % de chances de gagner un point par séance. Fatigue +3.' },
  setPieces: { label: 'Coups de pied arrêtés', short: 'CPA', description: 'Combinaisons sur corners et coups francs : force en match +0,4 % par séance (max. 2). Fatigue +1.' },
  recovery: { label: 'Récupération', short: 'RÉC', description: 'Soins, cryothérapie, étirements : fatigue −8 pour tout l’effectif.' },
  rest: { label: 'Repos', short: 'OFF', description: 'Journée libre : fatigue −4, moral de l’équipe +1.' },
};

export const WEEK_DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];

export const TALK_INFO: Record<TalkApproach, { label: string; description: string }> = {
  praise: { label: 'Féliciter', description: 'Valoriser son travail. Plaît aux Discrets, moins utile pour un joueur déjà au sommet.' },
  demand: { label: 'Exiger davantage', description: 'Le pousser dans ses retranchements : forme en hausse… sauf pour un Sanguin.' },
  promise: { label: 'Promettre du temps de jeu', description: 'Moral en forte hausse, mais son statut (et ses attentes) augmente.' },
  support: { label: 'Le soutenir', description: 'Écouter ses difficultés. Idéal quand le moral est bas.' },
};
