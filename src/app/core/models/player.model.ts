/** Postes détaillés. Les libellés français sont dans POSITION_LABELS. */
export type Position =
  | 'GK'
  | 'CB'
  | 'LB'
  | 'RB'
  | 'DM'
  | 'CM'
  | 'LM'
  | 'RM'
  | 'AM'
  | 'LW'
  | 'RW'
  | 'ST';

export type PositionGroup = 'GK' | 'DEF' | 'MID' | 'ATT';

export const POSITION_LABELS: Record<Position, string> = {
  GK: 'GB',
  CB: 'DC',
  LB: 'DG',
  RB: 'DD',
  DM: 'MDC',
  CM: 'MC',
  LM: 'MG',
  RM: 'MD',
  AM: 'MOC',
  LW: 'AG',
  RW: 'AD',
  ST: 'BU',
};

export const POSITION_GROUP: Record<Position, PositionGroup> = {
  GK: 'GK',
  CB: 'DEF',
  LB: 'DEF',
  RB: 'DEF',
  DM: 'MID',
  CM: 'MID',
  LM: 'MID',
  RM: 'MID',
  AM: 'MID',
  LW: 'ATT',
  RW: 'ATT',
  ST: 'ATT',
};

/** Ordre d'affichage dans les listes d'effectif. */
export const POSITION_ORDER: Position[] = ['GK', 'RB', 'CB', 'LB', 'DM', 'CM', 'RM', 'LM', 'AM', 'RW', 'LW', 'ST'];

/** Statut promis dans le contrat : fixe les attentes de temps de jeu (et donc le moral). */
export type SquadStatus = 'key' | 'regular' | 'rotation' | 'backup' | 'prospect';

export const SQUAD_STATUS_LABELS: Record<SquadStatus, string> = {
  key: 'Joueur clé',
  regular: 'Titulaire',
  rotation: 'Rotation',
  backup: 'Remplaçant',
  prospect: 'Espoir',
};

/** Part des matchs que le joueur s'attend à jouer selon son statut. */
export const STATUS_EXPECTED_SHARE: Record<SquadStatus, number> = {
  key: 0.85,
  regular: 0.65,
  rotation: 0.4,
  backup: 0.15,
  prospect: 0.1,
};

export const SQUAD_STATUS_ORDER: SquadStatus[] = ['key', 'regular', 'rotation', 'backup', 'prospect'];

export interface PlayerSeasonStats {
  appearances: number;
  goals: number;
  assists: number;
  /** Somme des notes de match, pour calculer la moyenne. */
  ratingSum: number;
}

export interface Player {
  id: string;
  firstName: string;
  lastName: string;
  nationality: string;
  age: number;
  position: Position;
  /** Note globale 1-99. */
  rating: number;
  /** Plafond de progression 1-99. */
  potential: number;
  /** Forme 0-10 (5 = normale). */
  form: number;
  /** Fatigue 0-100 (0 = condition physique parfaite). */
  fatigue: number;
  /** Moral individuel 0-100. */
  morale: number;
  /** Semaines d'indisponibilité restantes. */
  injuryWeeks: number;
  /** Nature de la blessure en cours. */
  injury: string | null;
  /** Salaire hebdomadaire en euros. */
  wage: number;
  contractYears: number;
  squadStatus: SquadStatus;
  /** Clause libératoire : un club qui la paie peut recruter le joueur sans l'accord du club. */
  releaseClause: number | null;
  /** null = joueur libre. */
  clubId: string | null;
  /** true = joueur du centre de formation (hors effectif professionnel). */
  youth: boolean;
  /** Club où le joueur a été formé (quota de joueurs formés au club). */
  homegrownClubId: string | null;
  transferListed: boolean;
  /** Participation aux derniers matchs du club (le plus récent à la fin). */
  recentApps: boolean[];
  /** Horodatage (voir nowStamp) avant lequel le joueur refuse de négocier. */
  talksBlockedUntil: number;
  stats: PlayerSeasonStats;
  /** Recruteur qui a repéré ce joueur via un booster (joueur non signé, resté sur le marché). */
  scoutedBy?: string;
  /** Personnalité (sinon déduite de l'identifiant, voir playerTraits). */
  traits?: PlayerTrait[];
}

/** Traits de personnalité des joueurs : ils nourrissent les scénarios (événements) du vestiaire. */
export type PlayerTrait = 'leader' | 'professional' | 'partygoer' | 'temperamental' | 'ambitious' | 'loyal' | 'clutch' | 'joker' | 'introvert';

export const PLAYER_TRAITS: Record<PlayerTrait, { label: string; description: string; opposite?: PlayerTrait }> = {
  leader: { label: 'Meneur', description: 'Le vestiaire l’écoute ; il prend la parole dans les moments difficiles.' },
  professional: { label: 'Professionnel', description: 'Hygiène de vie irréprochable, exemple pour les jeunes.', opposite: 'partygoer' },
  partygoer: { label: 'Fêtard', description: 'Aime la nuit et les sorties… pas toujours au bon moment.', opposite: 'professional' },
  temperamental: { label: 'Sanguin', description: 'Joueur à fleur de peau : coups de sang et coups d’éclat.' },
  ambitious: { label: 'Ambitieux', description: 'Veut jouer les premiers rôles, ici ou ailleurs.', opposite: 'loyal' },
  loyal: { label: 'Fidèle', description: 'Attaché au club et à son maillot.', opposite: 'ambitious' },
  clutch: { label: 'Décisif', description: 'Se transcende dans les grands matchs.' },
  joker: { label: 'Boute-en-train', description: 'L’ambiance du vestiaire, c’est lui.', opposite: 'introvert' },
  introvert: { label: 'Discret', description: 'Parle peu, a besoin de confiance pour s’exprimer.', opposite: 'joker' },
};

const TRAIT_ORDER = Object.keys(PLAYER_TRAITS) as PlayerTrait[];

/** Personnalité d'un joueur : stockée si un scénario l'a modifiée, sinon déduite de son identifiant (stable). */
export function playerTraits(p: Pick<Player, 'id' | 'traits'>): PlayerTrait[] {
  if (p.traits) return p.traits;
  let h = 2166136261;
  for (const ch of p.id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const out: PlayerTrait[] = [];
  const count = h % 10 < 3 ? 0 : h % 10 < 8 ? 1 : 2;
  for (let i = 0; i < count; i++) {
    const t = TRAIT_ORDER[(h >>> (8 + i * 5)) % TRAIT_ORDER.length];
    if (!out.includes(t) && !out.some((o) => PLAYER_TRAITS[o].opposite === t)) out.push(t);
  }
  return out;
}

export const hasTrait = (p: Pick<Player, 'id' | 'traits'> | undefined, t: PlayerTrait) => !!p && playerTraits(p).includes(t);

export const emptyStats = (): PlayerSeasonStats => ({ appearances: 0, goals: 0, assists: 0, ratingSum: 0 });

/** Nationalités membres de l'Union européenne parmi celles générées. */
export const EU_NATIONALITIES = new Set(['FRA', 'ESP', 'POR', 'BEL', 'ITA']);
export const isNonEu = (p: Pick<Player, 'nationality'>) => !EU_NATIONALITIES.has(p.nationality);
