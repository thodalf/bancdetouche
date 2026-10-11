import { CLUB_SEEDS, ClubSeed } from './clubs.data';

/** Championnats du monde du jeu (tous fictifs). */
export interface LeagueDef {
  id: string;
  name: string;
  short: string;
  /** Pays (code de nationalité) : coupe nationale et préférences de recrutement. */
  country: string;
  countryName: string;
  flag: string;
  /** 1 = première division. */
  tier: number;
  /** Décalage de niveau des effectifs par rapport à la grille de base. */
  ratingOffset: number;
  /** Richesse relative du championnat (droits TV, sponsors, primes). */
  wealth: number;
  /** Championnat supérieur / inférieur (montées et descentes). */
  up?: string;
  down?: string;
  /** Nombre de clubs qui montent / descendent. */
  swap?: number;
}

export const LEAGUES: LeagueDef[] = [
  { id: 'fr1', name: 'Division Élite', short: 'Élite', country: 'FRA', countryName: 'France', flag: '🇫🇷', tier: 1, ratingOffset: 0, wealth: 1, down: 'fr2', swap: 3 },
  { id: 'fr2', name: 'Division Excellence', short: 'Excellence', country: 'FRA', countryName: 'France', flag: '🇫🇷', tier: 2, ratingOffset: -8, wealth: 0.55, up: 'fr1', swap: 3 },
  { id: 'en1', name: 'Premier Division d’Albion', short: 'Albion', country: 'ENG', countryName: 'Albion', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', tier: 1, ratingOffset: 2, wealth: 1.6 },
  { id: 'es1', name: 'Liga Ibérica', short: 'Ibérica', country: 'ESP', countryName: 'Ibérie', flag: '🇪🇸', tier: 1, ratingOffset: 1, wealth: 1.2 },
  { id: 'it1', name: 'Lega Aurea', short: 'Aurea', country: 'ITA', countryName: 'Italia', flag: '🇮🇹', tier: 1, ratingOffset: 1, wealth: 1.15 },
  { id: 'de1', name: 'Meisterliga', short: 'Meister', country: 'GER', countryName: 'Teutonie', flag: '🇩🇪', tier: 1, ratingOffset: 1, wealth: 1.2 },
];

export const LEAGUES_BY_ID = new Map(LEAGUES.map((l) => [l.id, l]));
export const leagueDef = (id: string | undefined) => LEAGUES_BY_ID.get(id ?? 'fr1') ?? LEAGUES[0];

/** Coupes nationales : une par pays, nommée ici. */
export const CUP_NAMES: Record<string, string> = {
  FRA: 'Coupe Nationale',
  ENG: 'Albion Cup',
  ESP: 'Copa del Rey Ibérica',
  ITA: 'Coppa Aurea',
  GER: 'Teutonen-Pokal',
};

type Row = [id: string, name: string, short: string, city: string, primary: string, secondary: string, stadium: string, capacity: number, reputation: number, level: number];

/** Recettes et budgets de départ déduits de la réputation et de la richesse du championnat. */
function seed(row: Row, wealth: number): ClubSeed {
  const [id, name, shortName, city, primary, secondary, stadium, capacity, reputation, level] = row;
  const balanceM = Math.max(1.5, Math.round(140 * Math.pow(reputation / 90, 5) * wealth * 10) / 10);
  return {
    id, name, shortName, city, primary, secondary, stadium, capacity, reputation, level,
    balanceM,
    transferM: Math.max(0.6, Math.round(balanceM * 0.4 * 10) / 10),
    ticketPrice: Math.round((17 + (reputation - 44) * 0.6) * Math.sqrt(wealth)),
  };
}

const FR2: Row[] = [
  ['srb', 'Stade Rennac-Bocage', 'SRB', 'Rennac', '#b3001b', '#000000', 'Stade du Bocage', 21000, 49, 3],
  ['fcl', 'FC Lisière', 'FCL', 'Lisière', '#0b6e4f', '#ffffff', 'Stade des Chênes', 17000, 47, 3],
  ['asp', 'AS Pontvieux', 'ASP', 'Pontvieux', '#1e3a8a', '#f59e0b', 'Stade du Vieux-Pont', 16000, 46, 3],
  ['olc', 'Olympique Calanques', 'OLC', 'Calanques', '#0ea5e9', '#ffffff', 'Stade de la Pinède', 18000, 46, 3],
  ['usb', 'US Bastide-Haute', 'USB', 'Bastide', '#7c2d12', '#fde68a', 'Stade des Remparts', 13000, 44, 2],
  ['cst', 'Club Sportif de Tréguennec', 'CST', 'Tréguennec', '#111827', '#e11d48', 'Stade de l’Estran', 11000, 43, 2],
  ['fcv', 'FC Vallorbe', 'FCV', 'Vallorbe', '#15803d', '#facc15', 'Stade du Lac', 12000, 42, 2],
  ['ram', 'Racing Amandiers', 'RAM', 'Amandiers', '#be185d', '#ffffff', 'Stade des Amandiers', 10500, 41, 2],
  ['aso', 'AS Orgemont', 'ASO', 'Orgemont', '#f97316', '#1f2937', 'Stade Marcel-Roy', 10000, 40, 2],
  ['scb', 'SC Brévannes', 'SCB', 'Brévannes', '#2563eb', '#dc2626', 'Stade des Étangs', 9500, 39, 2],
  ['jsc', 'JS Cordemais', 'JSC', 'Cordemais', '#065f46', '#ffffff', 'Stade de l’Estuaire', 8500, 38, 1],
  ['fcg', 'FC Granvallée', 'FCG', 'Granvallée', '#4c1d95', '#fbbf24', 'Stade des Vignes', 9000, 37, 1],
  ['ess', 'Étoile Sportive Saulnières', 'ESS', 'Saulnières', '#dc2626', '#ffffff', 'Stade des Salines', 8000, 36, 1],
  ['abl', 'AS Belcastel', 'ABL', 'Belcastel', '#0f172a', '#38bdf8', 'Stade du Château', 7500, 35, 1],
  ['usm', 'US Montbrison-les-Bains', 'USM', 'Montbrison', '#16a34a', '#0f172a', 'Stade des Thermes', 7000, 34, 1],
  ['ocv', 'Olympique Cœur-de-Vire', 'OCV', 'Vire', '#a16207', '#ffffff', 'Stade du Bocage Normand', 6500, 33, 1],
];

const EN1: Row[] = [
  ['ldr', 'Lonsdale Royals', 'LDR', 'Lonsdale', '#c8102e', '#ffffff', 'Royal Park', 62000, 95, 5],
  ['mrc', 'Marlowe City', 'MRC', 'Marlowe', '#6cabdd', '#1c2c5b', 'City Arena', 55000, 93, 5],
  ['hgu', 'Highgate United', 'HGU', 'Highgate', '#da291c', '#000000', 'The Foundry', 74000, 92, 5],
  ['wst', 'Westbourne FC', 'WST', 'Westbourne', '#034694', '#ffffff', 'Bridge Lane', 41000, 89, 5],
  ['tnh', 'Thornhill Athletic', 'TNH', 'Thornhill', '#132257', '#ffffff', 'Thornhill Lane', 62000, 87, 4],
  ['kgr', 'Kingsmere Rovers', 'KGR', 'Kingsmere', '#003399', '#ffffff', 'Mere Park', 40000, 82, 4],
  ['ash', 'Ashcombe Town', 'ASH', 'Ashcombe', '#670e36', '#95bfe5', 'Ashcombe Road', 42000, 80, 4],
  ['wrh', 'Wearmouth Harriers', 'WRH', 'Wearmouth', '#241f20', '#ffffff', 'St Aidan’s Park', 52000, 79, 4],
  ['brf', 'Brackenford Albion', 'BRF', 'Brackenford', '#0057b8', '#ffffff', 'The Downs', 31000, 76, 3],
  ['wlw', 'Wolverhill Wanderers', 'WLW', 'Wolverhill', '#fdb913', '#231f20', 'Hill Street', 31000, 73, 3],
  ['fnm', 'Fenmarsh FC', 'FNM', 'Fenmarsh', '#ffffff', '#000000', 'Cottage Road', 26000, 71, 3],
  ['rvm', 'Ravensmoor', 'RVM', 'Ravensmoor', '#1b458f', '#c4122e', 'Ravensmoor Park', 25000, 70, 3],
  ['shv', 'Sherwood Vale', 'SHV', 'Sherwood', '#dd0000', '#ffffff', 'The Vale Ground', 30000, 68, 3],
  ['bmt', 'Bournemere Town', 'BMT', 'Bournemere', '#da291c', '#000000', 'Seaside Park', 11000, 64, 2],
  ['elm', 'Elmstead Town', 'ELM', 'Elmstead', '#3a64a3', '#ffffff', 'Elmstead Road', 30000, 62, 2],
  ['gbc', 'Graybridge City', 'GBC', 'Graybridge', '#003090', '#fdbe11', 'Graybridge Stadium', 32000, 61, 2],
];

const ES1: Row[] = [
  ['rca', 'Real Castalia', 'RCA', 'Castalia', '#ffffff', '#febe10', 'Estadio del Castillo', 81000, 96, 5],
  ['cem', 'CE Marítim', 'CEM', 'Marítim', '#a50044', '#004d98', 'Estadi del Mar', 99000, 93, 5],
  ['atc', 'Atlético Cerro Alto', 'ATC', 'Cerro Alto', '#cb3524', '#ffffff', 'Estadio del Cerro', 70000, 88, 5],
  ['aib', 'Athletic Ibaizabal', 'AIB', 'Ibaizabal', '#ee2523', '#ffffff', 'Campo de Ibaizabal', 53000, 82, 4],
  ['rtx', 'Real Txingudi', 'RTX', 'Txingudi', '#0067b1', '#ffffff', 'Estadio de Txingudi', 39500, 80, 4],
  ['caz', 'CF Azahar', 'CAZ', 'Azahar', '#ffe667', '#005187', 'Estadio del Azahar', 23000, 78, 4],
  ['rgq', 'Real Guadalquivir', 'RGQ', 'Marisma', '#0bb363', '#ffffff', 'Estadio de la Marisma', 60000, 77, 4],
  ['hsp', 'Hispalis FC', 'HSP', 'Hispalis', '#f43333', '#ffffff', 'Estadio de Triana', 43000, 74, 3],
  ['ctu', 'CD Turia', 'CTU', 'Turia', '#ffffff', '#ee3524', 'Estadio del Turia', 49000, 74, 3],
  ['uea', 'UE Empordà', 'UEA', 'Empordà', '#cd2534', '#ffffff', 'Estadi de l’Empordà', 14000, 71, 3],
  ['rrb', 'RC Rías Baixas', 'RRB', 'Rías Baixas', '#8ac3ee', '#ffffff', 'Estadio de las Rías', 29000, 68, 3],
  ['cir', 'CD Irati', 'CIR', 'Irati', '#d91a21', '#0a346f', 'Estadio del Irati', 23500, 66, 3],
  ['ctr', 'CD Tramuntana', 'CTR', 'Tramuntana', '#e20613', '#000000', 'Estadi de Tramuntana', 23000, 63, 2],
  ['adm', 'AD Manzanares', 'ADM', 'Manzanares', '#ffffff', '#e53027', 'Campo del Manzanares', 14500, 62, 2],
  ['cal', 'CD Alcarria', 'CAL', 'Alcarria', '#005999', '#ffffff', 'Estadio de la Alcarria', 17000, 60, 2],
  ['dgb', 'Deportivo Gorbeia', 'DGB', 'Gorbeia', '#0761af', '#ffffff', 'Estadio de Gorbeia', 19800, 58, 1],
];

const IT1: Row[] = [
  ['ins', 'Insubria FC', 'INS', 'Insubria', '#010e80', '#000000', 'Stadio dei Navigli', 75000, 92, 5],
  ['tau', 'Taurinense', 'TAU', 'Augusta', '#000000', '#ffffff', 'Stadio Augusta', 41000, 90, 5],
  ['med', 'AC Mediolanum', 'MED', 'Mediolanum', '#fb090b', '#000000', 'Stadio della Madonnina', 75000, 88, 5],
  ['par', 'SSC Partenope', 'PAR', 'Partenope', '#12a0d7', '#ffffff', 'Stadio del Golfo', 54000, 87, 5],
  ['cap', 'AS Capitolina', 'CAP', 'Capitolina', '#8e1f2f', '#f0bc42', 'Stadio dei Sette Colli', 70000, 84, 4],
  ['oro', 'Orobica Calcio', 'ORO', 'Orobica', '#1e71b8', '#000000', 'Stadio delle Orobie', 25000, 83, 4],
  ['tib', 'SS Tiberina', 'TIB', 'Capitolina', '#87d8f7', '#ffffff', 'Stadio del Tevere', 70000, 79, 4],
  ['mdc', 'AC Medicea', 'MDC', 'Florentia', '#482e92', '#ffffff', 'Stadio del Giglio', 43000, 77, 4],
  ['fel', 'Felsinea', 'FEL', 'Felsina', '#1a2f48', '#a21c26', 'Stadio delle Due Torri', 38000, 74, 3],
  ['grn', 'Granata Calcio', 'GRN', 'Augusta', '#881f19', '#ffffff', 'Stadio del Po', 28000, 70, 3],
  ['fri', 'Friulana', 'FRI', 'Utinum', '#000000', '#ffffff', 'Stadio delle Alpi Giulie', 25000, 67, 3],
  ['lig', 'Ligure 1893', 'LIG', 'Genua', '#c8102e', '#003a70', 'Stadio della Lanterna', 33000, 65, 3],
  ['srd', 'Sarda Calcio', 'SRD', 'Karalis', '#a21c26', '#002350', 'Stadio dei Nuraghi', 16000, 62, 2],
  ['sal', 'US Salentina', 'SAL', 'Lupiae', '#ffd700', '#e30613', 'Stadio del Salento', 31000, 59, 2],
  ['vdr', 'Valdarno', 'VDR', 'Valdarno', '#005daa', '#ffffff', 'Stadio del Valdarno', 16000, 57, 1],
  ['scg', 'Scaligera', 'SCG', 'Verona', '#002f6c', '#ffcd00', 'Stadio dell’Arena', 31000, 58, 1],
];

const DE1: Row[] = [
  ['ist', 'FC Isartal', 'IST', 'Isarstadt', '#dc052d', '#0066b2', 'Isar-Arena', 75000, 95, 5],
  ['r09', 'Ruhrstadt 09', 'R09', 'Ruhrstadt', '#fde100', '#000000', 'Ruhrstadion', 81000, 89, 5],
  ['svr', 'SV Rheinfeld', 'SVR', 'Rheinfeld', '#e32221', '#000000', 'Rheinfeld-Arena', 30000, 86, 5],
  ['slz', 'SC Leipzau', 'SLZ', 'Leipzau', '#dd0741', '#ffffff', 'Leipzau-Arena', 47000, 84, 4],
  ['emf', 'Eintracht Mainfurt', 'EMF', 'Mainfurt', '#e1000f', '#000000', 'Stadtwald-Stadion', 58000, 80, 4],
  ['vfn', 'VfB Neckarstadt', 'VFN', 'Neckarstadt', '#ffffff', '#e32219', 'Neckarufer-Stadion', 60000, 79, 4],
  ['scb2', 'SC Breisgau', 'SCB', 'Breisgau', '#000000', '#e2001a', 'Dreisam-Park', 34700, 74, 3],
  ['vfa', 'VfL Autostadt', 'VFA', 'Autostadt', '#65b32e', '#ffffff', 'Autostadt-Arena', 30000, 73, 3],
  ['bnr', 'Borussia Niederrhein', 'BNR', 'Niederrhein', '#000000', '#ffffff', 'Niederrhein-Park', 54000, 73, 3],
  ['tkr', 'TSG Kraichgau', 'TKR', 'Kraichgau', '#1c63b7', '#ffffff', 'Kraichgau-Arena', 30000, 70, 3],
  ['svw', 'SV Weserhafen', 'SVW', 'Weserhafen', '#1d9053', '#ffffff', 'Hafen-Arena', 42000, 70, 3],
  ['fsr', 'FSV Rheinhessen', 'FSR', 'Rheinhessen', '#c3141e', '#ffffff', 'Rheinhessen-Arena', 34000, 68, 3],
  ['ukp', 'Union Köpenau', 'UKP', 'Köpenau', '#eb1923', '#ffffff', 'Spreewald-Stadion', 22000, 66, 2],
  ['fcl2', 'FC Lechstadt', 'FCL', 'Lechstadt', '#ba3733', '#46714d', 'Lech-Arena', 30000, 62, 2],
  ['hkz', 'FC Hafenkiez', 'HKZ', 'Hafenkiez', '#6a4d3a', '#ffffff', 'Kiez-Stadion', 29500, 60, 2],
  ['hdh', 'Heidenstein 1846', 'HDH', 'Heidenstein', '#e2001a', '#003b79', 'Albstadion', 15000, 58, 1],
];

/** Tous les clubs du jeu, avec leur championnat de départ. */
export const WORLD_CLUBS: { seed: ClubSeed; leagueId: string }[] = [
  ...CLUB_SEEDS.map((seed) => ({ seed, leagueId: 'fr1' })),
  ...FR2.map((r) => ({ seed: seed(r, 0.55), leagueId: 'fr2' })),
  ...EN1.map((r) => ({ seed: seed(r, 1.6), leagueId: 'en1' })),
  ...ES1.map((r) => ({ seed: seed(r, 1.2), leagueId: 'es1' })),
  ...IT1.map((r) => ({ seed: seed(r, 1.15), leagueId: 'it1' })),
  ...DE1.map((r) => ({ seed: seed(r, 1.2), leagueId: 'de1' })),
];
