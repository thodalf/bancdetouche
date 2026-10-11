/** Définition des clubs (fictifs) d'une nouvelle partie. L'effectif est généré à partir de `level`. */
export interface ClubSeed {
  id: string;
  name: string;
  shortName: string;
  city: string;
  primary: string;
  secondary: string;
  stadium: string;
  capacity: number;
  reputation: number;
  level: number;
  /** Trésorerie de départ en M€. */
  balanceM: number;
  /** Budget transferts de départ en M€. */
  transferM: number;
  ticketPrice: number;
}

export const LEAGUE_NAME = 'Division Élite';
export const CUP_NAME = 'Coupe Nationale';

export const CLUB_SEEDS: ClubSeed[] = [
  { id: 'olv', name: 'Olympique de Valmont', shortName: 'OLV', city: 'Valmont', primary: '#1d4fa3', secondary: '#ffffff', stadium: 'Stade des Tilleuls', capacity: 52000, reputation: 90, level: 5, balanceM: 140, transferM: 60, ticketPrice: 45 },
  { id: 'rcp', name: 'Racing Club de Portlune', shortName: 'RCP', city: 'Portlune', primary: '#c8102e', secondary: '#111111', stadium: 'Arena du Môle', capacity: 47000, reputation: 86, level: 5, balanceM: 110, transferM: 45, ticketPrice: 42 },
  { id: 'asb', name: 'AS Bellerive', shortName: 'ASB', city: 'Bellerive', primary: '#0f7a4a', secondary: '#f2c230', stadium: 'Parc Joseph-Arnaud', capacity: 38000, reputation: 80, level: 4, balanceM: 70, transferM: 28, ticketPrice: 36 },
  { id: 'scm', name: 'Stade Montclair', shortName: 'SCM', city: 'Montclair', primary: '#5b2a86', secondary: '#ffffff', stadium: 'Stade de la Butte', capacity: 35000, reputation: 77, level: 4, balanceM: 55, transferM: 22, ticketPrice: 34 },
  { id: 'fcr', name: 'FC Rivecourt', shortName: 'FCR', city: 'Rivecourt', primary: '#e35205', secondary: '#1b1b1b', stadium: 'Stade des Forges', capacity: 33000, reputation: 74, level: 4, balanceM: 45, transferM: 18, ticketPrice: 32 },
  { id: 'usk', name: 'US Kerbrézec', shortName: 'USK', city: 'Kerbrézec', primary: '#111111', secondary: '#ffffff', stadium: 'Stade du Phare', capacity: 29000, reputation: 70, level: 3, balanceM: 32, transferM: 12, ticketPrice: 29 },
  { id: 'gfa', name: 'Girondins de l\'Aubrac', shortName: 'GFA', city: 'Aubrac', primary: '#002e5d', secondary: '#c9a227', stadium: 'Stade des Causses', capacity: 30000, reputation: 68, level: 3, balanceM: 30, transferM: 10, ticketPrice: 28 },
  { id: 'esv', name: 'ES Vauclair', shortName: 'ESV', city: 'Vauclair', primary: '#7fbf3f', secondary: '#123b1f', stadium: 'Stade de la Source', capacity: 24000, reputation: 65, level: 3, balanceM: 24, transferM: 9, ticketPrice: 26 },
  { id: 'cfa', name: 'CF Armoriac', shortName: 'CFA', city: 'Armoriac', primary: '#d4af37', secondary: '#1f1f1f', stadium: 'Stade de l\'Abbaye', capacity: 22000, reputation: 62, level: 3, balanceM: 20, transferM: 7, ticketPrice: 25 },
  { id: 'aco', name: 'AC Orbelle', shortName: 'ACO', city: 'Orbelle', primary: '#9b1b30', secondary: '#87ceeb', stadium: 'Stade du Moulin', capacity: 21000, reputation: 60, level: 2, balanceM: 16, transferM: 6, ticketPrice: 24 },
  { id: 'scl', name: 'SC Lanvaux', shortName: 'SCL', city: 'Lanvaux', primary: '#ffd200', secondary: '#0033a0', stadium: 'Stade des Landes', capacity: 18000, reputation: 57, level: 2, balanceM: 13, transferM: 5, ticketPrice: 22 },
  { id: 'fcm', name: 'FC Mirabeau', shortName: 'FCM', city: 'Mirabeau', primary: '#00796b', secondary: '#ffffff', stadium: 'Stade des Oliviers', capacity: 17000, reputation: 55, level: 2, balanceM: 11, transferM: 4, ticketPrice: 21 },
  { id: 'usc', name: 'US Chantelune', shortName: 'USC', city: 'Chantelune', primary: '#3b5ba5', secondary: '#e4002b', stadium: 'Stade de la Halle', capacity: 15000, reputation: 52, level: 2, balanceM: 9, transferM: 3.5, ticketPrice: 20 },
  { id: 'rcv', name: 'Red Star Verlaine', shortName: 'RSV', city: 'Verlaine', primary: '#2e7d32', secondary: '#d32f2f', stadium: 'Stade Gaston-Ribot', capacity: 14000, reputation: 50, level: 1, balanceM: 7, transferM: 2.5, ticketPrice: 19 },
  { id: 'asm', name: 'AS Merville-sur-Ys', shortName: 'ASM', city: 'Merville', primary: '#f57c00', secondary: '#ffffff', stadium: 'Stade des Écluses', capacity: 12000, reputation: 47, level: 1, balanceM: 5, transferM: 2, ticketPrice: 18 },
  { id: 'eco', name: 'Entente Côte d\'Opale', shortName: 'ECO', city: 'Opale', primary: '#4fc3f7', secondary: '#0d2b45', stadium: 'Stade des Dunes', capacity: 11000, reputation: 44, level: 1, balanceM: 4, transferM: 1.5, ticketPrice: 17 },
];

/** Note moyenne de l'effectif selon le niveau du club. */
export const LEVEL_MEAN_RATING: Record<number, number> = { 1: 62, 2: 66, 3: 70, 4: 74, 5: 79 };
