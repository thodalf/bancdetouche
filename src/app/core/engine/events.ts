import { Club, Effects, GameState, hasTrait, isNonEu, LifestyleId, Player, PLAYER_TRAITS, PlayerTrait, playerTraits, POSITION_GROUP, POSITION_LABELS, STAFF_ROLE_LABELS, StaffMember, StaffRole, TraitId } from '../models';
import { computeStandings } from './standings';
import { generateStaff, staffWage } from './characters';
import { clamp, createPlayer, SQUAD_TEMPLATE } from './player-factory';
import { expectedWage, marketValue, roundMoney } from './valuation';
import { Rng } from './rng';
import { addMoney, addNews, clubById, fullName, IdGen, squadOf, youthOf } from './world';

/** Contexte d'un événement : personnage et/ou joueur concernés. */
export interface EventContext {
  staff?: StaffMember;
  /** Second personnage (querelles au sein du staff). */
  staff2?: StaffMember;
  player?: Player;
  /** Second joueur (bagarre, rivalité…). */
  player2?: Player;
  /** Club concerné (prochain adversaire, club acheteur…). */
  club?: Club;
}

export interface EventOption {
  label: string;
  /** Conséquences annoncées, comme les infobulles de Crusader Kings. */
  outcome: string;
  apply: (s: GameState, ctx: EventContext, rng: Rng, ids: IdGen) => string;
  /** Option réservée (mode de vie, trait d'un membre du staff…), comme les choix spéciaux de Crusader Kings. */
  requires?: { label: string; test: (s: GameState, ctx: EventContext) => boolean };
}

/** Option réservée à un mode de vie de l'entraîneur. */
const lifestyle = (id: LifestyleId, label: string) => ({ label, test: (s: GameState) => s.manager.lifestyle === id });
/** Option réservée à un staff qui possède un trait. */
const staffTrait = (trait: TraitId, label: string) => ({ label, test: (s: GameState) => s.staff.some((m) => m.traits.includes(trait)) });

/** L'option est-elle accessible dans la situation actuelle ? */
export function optionAvailable(s: GameState, ctx: EventContext, o: EventOption): boolean {
  return !o.requires || o.requires.test(s, ctx);
}

export interface EventDef {
  id: string;
  title: string;
  /** Poste du staff mis en scène (si l'événement en a besoin). */
  role?: StaffRole;
  /** Besoin d'un joueur de l'effectif (choisi par `pickPlayer`). */
  pickPlayer?: (s: GameState) => Player | undefined;
  condition?: (s: GameState) => boolean;
  /** Suite d'un autre événement : jamais tiré au hasard, seulement programmé par une chaîne. */
  followUp?: boolean;
  pickPlayer2?: (s: GameState, first?: Player) => Player | undefined;
  /** Événement provoqué par la situation : il survient en priorité dès que sa condition est remplie. */
  urgent?: boolean;
  /** Personnage précis mis en scène (sinon un membre au hasard du poste). */
  pickStaff?: (s: GameState) => StaffMember | undefined;
  pickStaff2?: (s: GameState, first?: StaffMember) => StaffMember | undefined;
  pickClub?: (s: GameState) => Club | undefined;
  text: (ctx: EventContext, s: GameState) => string;
  options: EventOption[];
}

const name = (m?: StaffMember) => (m ? `${m.firstName} ${m.lastName}` : '');
const opinion = (m: StaffMember | undefined, d: number) => m && (m.opinion = clamp(m.opinion + d, m.traits.includes('loyal') ? 40 : 0, 100));
const modifier = (s: GameState, ids: IdGen, label: string, effects: Effects, weeks: number) =>
  s.modifiers.push({ id: ids('m'), label, effects, weeksLeft: weeks });
const pay = (s: GameState, amount: number, label: string) => addMoney(s, s.userClubId, 'staff', -amount, label);
const canPay = (s: GameState, amount: number) => clubById(s, s.userClubId).balance >= amount;


// ------------------------------------------------------------------ lecture du contexte

type Result = 'W' | 'D' | 'L';

/** Derniers résultats du club de l'entraîneur, du plus récent au plus ancien. */
export function recentResults(s: GameState, n = 6): Result[] {
  const id = s.userClubId;
  return s.fixtures
    .filter((f) => f.played && (f.homeId === id || f.awayId === id))
    .sort((a, b) => b.week - a.week)
    .slice(0, n)
    .map((f) => {
      const [mine, theirs] = f.homeId === id ? [f.homeGoals, f.awayGoals] : [f.awayGoals, f.homeGoals];
      if (mine === theirs && f.penalties) {
        const [pm, pt] = f.homeId === id ? [f.penalties.home, f.penalties.away] : [f.penalties.away, f.penalties.home];
        return pm > pt ? 'W' : 'L';
      }
      return mine > theirs ? 'W' : mine < theirs ? 'L' : 'D';
    });
}

/** Série en cours : nombre de résultats identiques consécutifs. */
export function streak(s: GameState, kind: Result): number {
  let n = 0;
  for (const r of recentResults(s, 10)) {
    if (r !== kind) break;
    n++;
  }
  return n;
}

export function leaguePosition(s: GameState): number {
  return computeStandings(s.clubs.map((c) => c.id), s.fixtures).findIndex((r) => r.clubId === s.userClubId) + 1;
}

/** Prochain match de l'entraîneur (cette semaine ou la suivante). */
function nextFixture(s: GameState) {
  return s.fixtures
    .filter((x) => !x.played && x.week >= s.currentWeek && x.week <= s.currentWeek + 1 && (x.homeId === s.userClubId || x.awayId === s.userClubId))
    .sort((a, b) => a.week - b.week)[0];
}

/** Prochain match de championnat ou de coupe de l'entraîneur (cette semaine ou la suivante). */
function nextOpponent(s: GameState): Club | undefined {
  const f = s.fixtures
    .filter((x) => !x.played && x.week >= s.currentWeek && x.week <= s.currentWeek + 1 && (x.homeId === s.userClubId || x.awayId === s.userClubId))
    .sort((a, b) => a.week - b.week)[0];
  return f ? clubById(s, f.homeId === s.userClubId ? f.awayId : f.homeId) : undefined;
}

const userSquad = (s: GameState) => squadOf(s, s.userClubId);
const byRating = (players: Player[]) => [...players].sort((a, b) => b.rating - a.rating);
const teamMorale = (s: GameState, d: number) => {
  const club = clubById(s, s.userClubId);
  club.morale = clamp(club.morale + d, 0, 100);
};
const board = (s: GameState, d: number) => (s.board.confidence = clamp(s.board.confidence + d, 0, 100));
const morale = (p: Player | undefined, d: number) => p && (p.morale = clamp(p.morale + d, 0, 100));
const pname = (c: EventContext) => (c.player ? fullName(c.player) : 'Le joueur');
const p2name = (c: EventContext) => (c.player2 ? fullName(c.player2) : 'son coéquipier');
const stamp = (s: GameState) => s.season * 100 + s.currentWeek;
/** Programme la suite d'un événement dans quelques semaines, avec les mêmes protagonistes. */
const chain = (s: GameState, defId: string, weeks: number, c: EventContext) =>
  (s.eventQueue ??= []).push({ defId, staffId: c.staff?.id, playerId: c.player?.id, player2Id: c.player2?.id, clubId: c.club?.id, due: stamp(s) + weeks });
const ownPlayer = (s: GameState, p?: Player) => !!p && p.clubId === s.userClubId;
/** Option réservée à un joueur qui a un trait de personnalité. */
const playerTrait = (trait: PlayerTrait, who: 'player' | 'player2' = 'player') => ({
  label: PLAYER_TRAITS[trait].label,
  test: (_s: GameState, c: EventContext) => hasTrait(c[who], trait),
});
/** Les scénarios peuvent transformer la personnalité d'un joueur. */
const setTraits = (p: Player | undefined, add: PlayerTrait[], remove: PlayerTrait[] = []) => {
  if (!p) return;
  const next = playerTraits(p).filter((t) => !remove.includes(t) && !add.some((a) => PLAYER_TRAITS[a].opposite === t));
  p.traits = [...next, ...add.filter((a) => !next.includes(a))];
};
/** Deux joueurs du même poste et de niveau proche parmi les 16 meilleurs. */
function positionRivals(s: GameState): [Player, Player] | undefined {
  const top = byRating(userSquad(s)).slice(0, 16);
  for (const a of top) {
    const b = top.find((x) => x !== a && x.position === a.position && Math.abs(x.rating - a.rating) <= 3);
    if (b) return [a, b];
  }
  return undefined;
}
/** Un joueur en fin de carrière devient membre du staff : ses traits de personnalité deviennent des traits de personnage. */
function playerToStaff(s: GameState, p: Player, role: StaffRole, rng: Rng, ids: IdGen): StaffMember {
  const m = generateStaff(rng, ids, role, 9 + Math.round((p.rating - 60) / 6));
  const map: Partial<Record<PlayerTrait, TraitId>> = { leader: 'charismatic', professional: 'meticulous', loyal: 'loyal', temperamental: 'hothead', ambitious: 'ambitious', joker: 'diplomat' };
  const traits = [...new Set(playerTraits(p).map((t) => map[t]).filter((x): x is TraitId => !!x)), 'veteran' as TraitId].slice(0, 3);
  Object.assign(m, { firstName: p.firstName, lastName: p.lastName, nationality: p.nationality, age: p.age + 1, traits, opinion: 75, contractYears: 2 });
  m.wage = staffWage(m.skill, traits);
  s.staff = s.staff.filter((x) => x.role !== role || role === 'scout');
  s.staff.push(m);
  return m;
}
const withTrait = (s: GameState, t: PlayerTrait) => byRating(userSquad(s)).filter((p) => hasTrait(p, t));
const leaveClub = (s: GameState, p: Player) => {
  const club = clubById(s, s.userClubId);
  club.tactic.lineup = club.tactic.lineup.map((id) => (id === p.id ? null : id));
  s.players = s.players.filter((x) => x.id !== p.id);
};
/** Prix proposé pour un jeune selon sa valeur et son potentiel. */
const youthFee = (p?: Player) => (p ? roundMoney(Math.max(1_500_000, marketValue(p) * 2.2 + (p.potential - 70) * 250_000)) : 0);
const millions = (n: number) => `${(n / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M€`;

/** Catalogue d'événements à choix. */
export const EVENTS: EventDef[] = [
  {
    id: 'new-method',
    title: 'Une méthode révolutionnaire',
    role: 'fitness',
    text: (c) => `${name(c.staff)} revient d'un congrès avec une méthode de récupération inédite. « Les grands clubs européens ne jurent que par ça », assure-t-il.`,
    options: [
      {
        label: 'Adopter la méthode',
        outcome: 'Récupération +15 % pendant 8 semaines, risque de blessure +10 % pendant 4 semaines. Opinion +8.',
        apply: (s, c, _r, ids) => {
          modifier(s, ids, 'Nouvelle méthode de récupération', { recovery: 0.15 }, 8);
          modifier(s, ids, 'Période d’adaptation physique', { injuryRisk: 0.1 }, 4);
          opinion(c.staff, 8);
          return 'Le staff physique se met au travail.';
        },
      },
      {
        label: 'Rester sur les fondamentaux',
        outcome: 'Aucun risque. Opinion −10.',
        apply: (_s, c) => {
          opinion(c.staff, -10);
          return `${name(c.staff)} est déçu.`;
        },
      },
    ],
  },
  {
    id: 'scout-lead',
    title: 'Une piste à l’étranger',
    role: 'scout',
    text: (c) => `${name(c.staff)} a entendu parler d'une pépite dans un championnat exotique. Il faudrait financer un voyage.`,
    options: [
      {
        label: 'Financer le voyage (300 k€)',
        outcome: 'Un booster de recruteur supplémentaire, de qualité Argent au minimum. Opinion +6.',
        apply: (s, c, _r, ids) => {
          if (!canPay(s, 300_000)) return 'La trésorerie ne le permet pas.';
          pay(s, 300_000, 'Voyage de recrutement');
          const tier = (c.staff?.skill ?? 0) >= 15 ? 'gold' : 'silver';
          s.boosters.items.push({ id: ids('bi'), tier, focus: 'youth', scoutName: name(c.staff), scoutSkill: c.staff?.skill ?? 8 });
          opinion(c.staff, 6);
          return 'Un nouveau rapport arrive dans vos boosters.';
        },
      },
      {
        label: 'Pas cette fois',
        outcome: 'Opinion −5.',
        apply: (_s, c) => {
          opinion(c.staff, -5);
          return 'Le recruteur range son dossier.';
        },
      },
    ],
  },
  {
    id: 'dressing-room',
    title: 'Tension dans le vestiaire',
    role: 'assistant',
    pickPlayer: (s) => squadOf(s, s.userClubId).sort((a, b) => a.morale - b.morale)[0],
    text: (c) => `${c.player ? fullName(c.player) : 'Un joueur'} s'est violemment accroché avec ${name(c.staff)} à l'entraînement. Tout le vestiaire attend votre arbitrage.`,
    options: [
      {
        label: 'Soutenir le joueur',
        outcome: 'Moral du joueur +15, opinion de l’adjoint −12.',
        apply: (_s, c) => {
          if (c.player) c.player.morale = clamp(c.player.morale + 15, 0, 100);
          opinion(c.staff, -12);
          return 'Le joueur se sent compris ; l’adjoint ronge son frein.';
        },
      },
      {
        label: 'Soutenir le staff',
        outcome: 'Opinion de l’adjoint +10, moral du joueur −12, moral de l’équipe +3.',
        apply: (s, c) => {
          if (c.player) c.player.morale = clamp(c.player.morale - 12, 0, 100);
          opinion(c.staff, 10);
          const club = clubById(s, s.userClubId);
          club.morale = clamp(club.morale + 3, 0, 100);
          return 'L’autorité du staff sort renforcée.';
        },
      },
      {
        label: 'Réunir les deux et calmer le jeu',
        outcome: 'Petits gains des deux côtés (moral +5, opinion +3).',
        apply: (_s, c) => {
          if (c.player) c.player.morale = clamp(c.player.morale + 5, 0, 100);
          opinion(c.staff, 3);
          return 'Une poignée de main, et chacun repart au travail.';
        },
      },
    ],
  },
  {
    id: 'poach',
    title: 'Un rival courtise votre adjoint',
    role: 'assistant',
    condition: (s) => !!s.staff.find((m) => m.role === 'assistant' && !m.traits.includes('loyal')),
    text: (c) => `Un club rival propose à ${name(c.staff)} de devenir entraîneur principal. Il vient vous en parler avant de répondre.`,
    options: [
      {
        label: 'L’augmenter de 30 %',
        outcome: 'Il reste, opinion +15, salaire +30 %.',
        apply: (_s, c) => {
          if (c.staff) c.staff.wage = Math.round(c.staff.wage * 1.3);
          opinion(c.staff, 15);
          return `${name(c.staff)} prolonge l’aventure.`;
        },
      },
      {
        label: 'Faire appel à sa fidélité',
        outcome: 'Il reste si son opinion dépasse 60 ; sinon il part.',
        apply: (s, c, _r, ids) => {
          if (!c.staff) return '';
          if (c.staff.opinion > 60) {
            opinion(c.staff, 5);
            return `${name(c.staff)} reste par attachement au projet.`;
          }
          s.staff = s.staff.filter((m) => m.id !== c.staff!.id);
          addNews(s, 'staff', `${name(c.staff)} s’en va`, 'Votre adjoint a accepté l’offre du club rival.', ids);
          return 'Il accepte l’offre et s’en va.';
        },
      },
      {
        label: 'Le laisser partir',
        outcome: 'Il quitte le club. Les autres membres du staff apprécient votre honnêteté (opinion +3).',
        apply: (s, c, _r, ids) => {
          if (!c.staff) return '';
          s.staff = s.staff.filter((m) => m.id !== c.staff!.id);
          s.staff.forEach((m) => opinion(m, 3));
          addNews(s, 'staff', `${name(c.staff)} s’en va`, 'Vous avez souhaité bonne chance à votre adjoint.', ids);
          return 'Bonne route.';
        },
      },
    ],
  },
  {
    id: 'seminar',
    title: 'Séminaire de formation',
    role: 'youth',
    text: (c) => `La fédération organise un séminaire réservé aux formateurs. ${name(c.staff)} aimerait y participer.`,
    options: [
      {
        label: 'L’inscrire (150 k€)',
        outcome: 'Compétence +1, opinion +5.',
        apply: (s, c) => {
          if (!canPay(s, 150_000)) return 'La trésorerie ne le permet pas.';
          pay(s, 150_000, 'Séminaire de formation');
          if (c.staff) c.staff.skill = Math.min(20, c.staff.skill + 1);
          opinion(c.staff, 5);
          return 'Il revient plein d’idées.';
        },
      },
      {
        label: 'Refuser',
        outcome: 'Opinion −6.',
        apply: (_s, c) => {
          opinion(c.staff, -6);
          return 'Il n’ira pas.';
        },
      },
    ],
  },
  {
    id: 'press',
    title: 'Conférence de presse houleuse',
    text: () => 'Un journaliste vous interroge sèchement sur les choix de l’équipe et les rumeurs de crise.',
    options: [
      {
        label: 'Répondre avec franchise',
        outcome: 'Confiance de la direction +4, moral −2.',
        apply: (s) => {
          s.board.confidence = clamp(s.board.confidence + 4, 0, 100);
          const club = clubById(s, s.userClubId);
          club.morale = clamp(club.morale - 2, 0, 100);
          return 'La direction apprécie votre honnêteté.';
        },
      },
      {
        label: 'Défendre vos joueurs bec et ongles',
        outcome: 'Moral +5, confiance de la direction −3.',
        apply: (s) => {
          const club = clubById(s, s.userClubId);
          club.morale = clamp(club.morale + 5, 0, 100);
          s.board.confidence = clamp(s.board.confidence - 3, 0, 100);
          return 'Le vestiaire fait bloc derrière vous.';
        },
      },
      {
        label: 'Langue de bois',
        outcome: 'Aucun effet.',
        apply: () => 'Rien à signaler.',
      },
    ],
  },
  {
    id: 'medical',
    title: 'Le médecin réclame du matériel',
    role: 'doctor',
    text: (c) => `${name(c.staff)} veut équiper le club d'une unité de cryothérapie dernier cri.`,
    options: [
      {
        label: 'Acheter l’équipement (500 k€)',
        outcome: 'Durée des blessures −20 % pendant 20 semaines. Opinion +8.',
        apply: (s, c, _r, ids) => {
          if (!canPay(s, 500_000)) return 'La trésorerie ne le permet pas.';
          pay(s, 500_000, 'Équipement médical');
          modifier(s, ids, 'Unité de cryothérapie', { injuryDuration: -0.2 }, 20);
          opinion(c.staff, 8);
          return 'L’équipement est installé.';
        },
      },
      {
        label: 'Refuser',
        outcome: 'Opinion −8.',
        apply: (_s, c) => {
          opinion(c.staff, -8);
          return 'Le médecin est contrarié.';
        },
      },
    ],
  },
  {
    id: 'fans',
    title: 'Les supporters s’impatientent',
    condition: (s) => clubById(s, s.userClubId).morale < 50,
    text: () => 'Après une série décevante, un groupe de supporters demande à vous rencontrer au centre d’entraînement.',
    options: [
      {
        label: 'Les recevoir',
        outcome: 'Moral +6, confiance de la direction +2.',
        apply: (s) => {
          const club = clubById(s, s.userClubId);
          club.morale = clamp(club.morale + 6, 0, 100);
          s.board.confidence = clamp(s.board.confidence + 2, 0, 100);
          return 'Une discussion franche apaise les esprits.';
        },
      },
      {
        label: 'Les ignorer',
        outcome: 'Moral −3.',
        apply: (s) => {
          const club = clubById(s, s.userClubId);
          club.morale = clamp(club.morale - 3, 0, 100);
          return 'La grogne monte dans les tribunes.';
        },
      },
    ],
  },
  {
    id: 'camp',
    title: 'Stage commando',
    role: 'fitness',
    text: (c) => `${name(c.staff)} propose trois jours de stage commando avec l'armée pour souder le groupe.`,
    options: [
      {
        label: 'Partir en stage',
        outcome: 'Moral de l’équipe +8, fatigue +12 pour tous les joueurs.',
        apply: (s) => {
          const club = clubById(s, s.userClubId);
          club.morale = clamp(club.morale + 8, 0, 100);
          squadOf(s, s.userClubId).forEach((p) => (p.fatigue = clamp(p.fatigue + 12, 0, 100)));
          return 'Le groupe revient soudé… et courbaturé.';
        },
      },
      {
        label: 'Garder le programme habituel',
        outcome: 'Aucun effet.',
        apply: () => 'Le programme continue.',
      },
    ],
  },
  {
    id: 'director-deal',
    title: 'Le directeur sportif a un plan',
    role: 'director',
    text: (c) => `${name(c.staff)} assure pouvoir faire monter les enchères sur vos joueurs grâce à ses contacts, si vous lui laissez carte blanche.`,
    options: [
      {
        label: 'Lui laisser carte blanche',
        outcome: 'Prix de vente +10 % pendant 6 semaines. Opinion +6.',
        apply: (s, c, _r, ids) => {
          modifier(s, ids, 'Réseau du directeur sportif', { salePrice: 0.1 }, 6);
          opinion(c.staff, 6);
          return 'Les téléphones chauffent.';
        },
      },
      {
        label: 'Garder la main',
        outcome: 'Opinion −4.',
        apply: (_s, c) => {
          opinion(c.staff, -4);
          return 'Il s’incline.';
        },
      },
    ],
  },

  // ---------------------------------------------------------------- événements contextuels
  {
    id: 'losing-streak',
    title: 'Réunion de crise',
    urgent: true,
    condition: (s) => streak(s, 'L') >= 3,
    text: (_c, s) => `${streak(s, 'L')} défaites d'affilée. Le vestiaire est silencieux, la presse parle déjà de votre avenir et le président a demandé à vous voir.`,
    options: [
      {
        label: 'Huis clos avec les joueurs',
        outcome: 'Moral de l’équipe +8. Force en match +2 % pendant 2 semaines.',
        apply: (s, _c, _r, ids) => {
          teamMorale(s, 8);
          modifier(s, ids, 'Électrochoc du huis clos', { matchStrength: 0.02 }, 2);
          return 'Les cadres prennent la parole : le groupe veut réagir.';
        },
      },
      {
        label: 'Désigner les responsables publiquement',
        outcome: 'Confiance de la direction +5, moral de l’équipe −8, moral des 3 joueurs les moins bien notés −10.',
        apply: (s) => {
          board(s, 5);
          teamMorale(s, -8);
          byRating(userSquad(s)).slice(-3).forEach((p) => morale(p, -10));
          return 'La direction apprécie la fermeté ; les joueurs visés beaucoup moins.';
        },
      },
      {
        label: 'Discours de l’homme fort',
        outcome: 'Moral de l’équipe +12, force en match +3 % pendant 2 semaines, confiance de la direction +3.',
        requires: lifestyle('leader', 'Meneur d’hommes'),
        apply: (s, _c, _r, ids) => {
          teamMorale(s, 12);
          modifier(s, ids, 'Ils iraient au feu pour vous', { matchStrength: 0.03 }, 2);
          board(s, 3);
          return 'Votre charisme retourne le vestiaire.';
        },
      },
      {
        label: 'Mettre votre poste dans la balance',
        outcome: 'Si la direction vous fait encore confiance (50 et plus) : confiance +10 et moral +5. Sinon : confiance −10.',
        apply: (s) => {
          if (s.board.confidence >= 50) {
            board(s, 10);
            teamMorale(s, 5);
            return 'Le président vous renouvelle publiquement sa confiance.';
          }
          board(s, -10);
          return 'Le président ne dit rien… et ce silence en dit long.';
        },
      },
    ],
  },
  {
    id: 'winning-streak',
    title: 'L’euphorie gagne la ville',
    urgent: true,
    condition: (s) => streak(s, 'W') >= 4,
    text: (_c, s) => `${streak(s, 'W')} victoires de rang ! Les supporters rêvent tout haut et les joueurs sont invités sur tous les plateaux télé.`,
    options: [
      {
        label: 'Garder les pieds sur terre',
        outcome: 'Force en match +2 % pendant 3 semaines.',
        apply: (s, _c, _r, ids) => {
          modifier(s, ids, 'Concentration maximale', { matchStrength: 0.02 }, 3);
          return 'Rien n’est encore gagné, répétez-vous dans le vestiaire.';
        },
      },
      {
        label: 'Fêter ça avec les supporters',
        outcome: 'Moral +8, recettes +6 % pendant 4 semaines, risque de blessure +8 % pendant 2 semaines.',
        apply: (s, _c, _r, ids) => {
          teamMorale(s, 8);
          modifier(s, ids, 'Ferveur populaire', { income: 0.06 }, 4);
          modifier(s, ids, 'Lendemains de fête', { injuryRisk: 0.08 }, 2);
          return 'Le stade affiche complet pour les prochaines semaines.';
        },
      },
      {
        label: 'Réclamer des moyens à la direction',
        outcome: 'Confiance de la direction −3, budget transferts +10 %.',
        apply: (s) => {
          board(s, -3);
          const club = clubById(s, s.userClubId);
          club.transferBudget = Math.round(club.transferBudget * 1.1);
          return 'Le président ouvre un peu le chéquier, en grimaçant.';
        },
      },
    ],
  },
  {
    id: 'unhappy-star',
    title: 'Un cadre veut partir',
    urgent: true,
    pickPlayer: (s) => byRating(userSquad(s)).slice(0, 8).filter((p) => p.morale < 35 && !p.transferListed)[0],
    condition: (s) => byRating(userSquad(s)).slice(0, 8).some((p) => p.morale < 35 && !p.transferListed),
    text: (c) => `${pname(c)} frappe à la porte de votre bureau. Temps de jeu, ambitions du club : rien ne lui convient, et son agent a déjà prévenu la presse.`,
    options: [
      {
        label: 'Lui promettre un rôle de premier plan',
        outcome: 'Statut « Joueur clé », moral du joueur +20 (il attendra désormais 85 % de temps de jeu).',
        apply: (_s, c) => {
          if (c.player) c.player.squadStatus = 'key';
          morale(c.player, 20);
          return `${pname(c)} accepte de vous laisser une chance.`;
        },
      },
      {
        label: 'Le placer sur la liste des transferts',
        outcome: 'Joueur transférable, moral du joueur +6. Les offres vont arriver.',
        apply: (_s, c) => {
          if (c.player) c.player.transferListed = true;
          morale(c.player, 6);
          return 'Son agent se met au travail.';
        },
      },
      {
        label: 'Rappeler qui décide ici',
        outcome: 'Moral du joueur −10, moral de l’équipe +3, opinion de l’adjoint +5.',
        apply: (s, c) => {
          morale(c.player, -10);
          teamMorale(s, 3);
          opinion(s.staff.find((m) => m.role === 'assistant'), 5);
          return 'Le message est passé, mais le joueur boude.';
        },
      },
    ],
  },
  {
    id: 'star-injury',
    title: 'Coup dur à l’infirmerie',
    urgent: true,
    pickPlayer: (s) => byRating(userSquad(s)).slice(0, 5).find((p) => p.injuryWeeks >= 4),
    condition: (s) => byRating(userSquad(s)).slice(0, 5).some((p) => p.injuryWeeks >= 4),
    text: (c) => `${pname(c)} souffre de ${c.player?.injury?.toLowerCase() ?? 'une blessure'} : ${c.player?.injuryWeeks ?? '?'} semaines d'absence annoncées. Le staff médical attend vos consignes.`,
    options: [
      {
        label: 'L’envoyer chez un spécialiste (250 k€)',
        outcome: 'Indisponibilité réduite de 40 %. Moral du joueur +5.',
        apply: (s, c) => {
          if (!canPay(s, 250_000)) return 'La trésorerie ne le permet pas.';
          pay(s, 250_000, 'Consultation d’un spécialiste');
          if (c.player) c.player.injuryWeeks = Math.max(1, Math.round(c.player.injuryWeeks * 0.6));
          morale(c.player, 5);
          return 'Le spécialiste est optimiste.';
        },
      },
      {
        label: 'Faire confiance au médecin du club',
        outcome: 'Opinion du médecin +8.',
        apply: (s) => {
          opinion(s.staff.find((m) => m.role === 'doctor'), 8);
          return 'Le médecin apprécie votre confiance.';
        },
      },
      {
        label: 'Accélérer son retour',
        outcome: 'Indisponibilité divisée par deux, mais il revient fatigué (fatigue 45). Opinion du médecin −10.',
        apply: (s, c) => {
          if (c.player) {
            c.player.injuryWeeks = Math.max(1, Math.round(c.player.injuryWeeks / 2));
            c.player.fatigue = Math.max(c.player.fatigue, 45);
          }
          opinion(s.staff.find((m) => m.role === 'doctor'), -10);
          return 'Le médecin désapprouve formellement.';
        },
      },
    ],
  },
  {
    id: 'contract-expiring',
    title: 'Ultimatum d’un agent',
    pickPlayer: (s) => byRating(userSquad(s)).slice(0, 11).find((p) => p.contractYears <= 1 && p.age < 32),
    condition: (s) => s.currentWeek >= 8 && byRating(userSquad(s)).slice(0, 11).some((p) => p.contractYears <= 1 && p.age < 32),
    text: (c) => `L'agent de ${pname(c)} vous appelle : son client arrive en fin de contrat et plusieurs clubs le sollicitent. Il veut une réponse cette semaine.`,
    options: [
      {
        label: 'Prolonger d’un an, salaire +20 %',
        outcome: 'Contrat +1 an, salaire +20 %, moral du joueur +8.',
        apply: (_s, c) => {
          if (c.player) {
            c.player.contractYears += 1;
            c.player.wage = Math.round(c.player.wage * 1.2);
          }
          morale(c.player, 8);
          return 'Affaire conclue en dix minutes.';
        },
      },
      {
        label: 'Laisser traîner',
        outcome: 'Moral du joueur −8. L’agent refuse de négocier pendant 4 semaines.',
        apply: (s, c) => {
          morale(c.player, -8);
          if (c.player) c.player.talksBlockedUntil = s.season * 100 + s.currentWeek + 4;
          return 'L’agent raccroche sèchement.';
        },
      },
      {
        label: 'Le mettre en vente',
        outcome: 'Joueur transférable : mieux vaut le vendre que le perdre libre.',
        apply: (_s, c) => {
          if (c.player) c.player.transferListed = true;
          return 'Le joueur est proposé aux autres clubs.';
        },
      },
    ],
  },
  {
    id: 'youth-prodigy',
    title: 'Un prodige au centre de formation',
    role: 'youth',
    pickPlayer: (s) => [...youthOf(s, s.userClubId)].sort((a, b) => b.potential - a.potential)[0],
    condition: (s) => youthOf(s, s.userClubId).some((p) => p.potential >= 78),
    text: (c) => `${name(c.staff)} n'en dort plus : ${pname(c)}, ${c.player?.age ?? '?'} ans, « a quelque chose que les autres n'ont pas ». Il vous demande de lui donner sa chance.`,
    options: [
      {
        label: 'Le promouvoir en équipe première',
        outcome: 'Le jeune rejoint l’effectif professionnel (statut Espoir), moral +15. Opinion du formateur +6.',
        apply: (_s, c) => {
          if (c.player) {
            c.player.youth = false;
            c.player.squadStatus = 'prospect';
            c.player.contractYears = Math.max(c.player.contractYears, 3);
          }
          morale(c.player, 15);
          opinion(c.staff, 6);
          return `${pname(c)} découvre le vestiaire des pros.`;
        },
      },
      {
        label: 'Le protéger encore un an',
        outcome: 'Progression des jeunes +10 % pendant 10 semaines.',
        apply: (s, _c, _r, ids) => {
          modifier(s, ids, 'Programme individualisé', { youthGrowth: 0.1 }, 10);
          return 'Un programme sur mesure est mis en place.';
        },
      },
    ],
  },
  {
    id: 'big-match',
    title: 'Veille de choc',
    pickClub: (s) => nextOpponent(s),
    condition: (s) => {
      const opp = nextOpponent(s);
      return !!opp && opp.reputation >= clubById(s, s.userClubId).reputation - 3;
    },
    text: (c) => `Le prochain adversaire, ${c.club?.name ?? 'un gros morceau'}, est sur toutes les lèvres. Toute la ville ne parle que de ce match.`,
    options: [
      {
        label: 'Discours de motivation',
        outcome: 'Force en match +3 % pendant 1 semaine, moral +3.',
        apply: (s, _c, _r, ids) => {
          modifier(s, ids, 'Gonflés à bloc', { matchStrength: 0.03 }, 1);
          teamMorale(s, 3);
          return 'Les joueurs sortent de la causerie les yeux brillants.';
        },
      },
      {
        label: 'Séance de récupération',
        outcome: 'Fatigue −15 pour tout l’effectif.',
        apply: (s) => {
          userSquad(s).forEach((p) => (p.fatigue = clamp(p.fatigue - 15, 0, 100)));
          return 'Bains froids et massages pour tout le monde.';
        },
      },
      {
        label: 'Entraînement à huis clos',
        outcome: 'Opinion de l’adjoint +5, force en match +1 % pendant 1 semaine.',
        apply: (s, _c, _r, ids) => {
          opinion(s.staff.find((m) => m.role === 'assistant'), 5);
          modifier(s, ids, 'Plan secret', { matchStrength: 0.01 }, 1);
          return 'Personne ne saura rien de votre plan.';
        },
      },
    ],
  },
  {
    id: 'sponsor',
    title: 'Un sponsor frappe à la porte',
    condition: (s) => s.currentWeek >= 6 && leaguePosition(s) <= 4,
    text: () => 'Vos résultats attirent les marques : une entreprise de paris en ligne veut s’afficher sur le maillot pour la fin de saison.',
    options: [
      {
        label: 'Accepter (1,5 M€)',
        outcome: '+1,5 M€, confiance de la direction +3, moral de l’équipe −2 (les supporters grincent des dents).',
        apply: (s) => {
          addMoney(s, s.userClubId, 'sponsor', 1_500_000, 'Sponsor maillot exceptionnel');
          board(s, 3);
          teamMorale(s, -2);
          return 'Le contrat est signé.';
        },
      },
      {
        label: 'Faire monter les enchères',
        outcome: 'Une chance sur deux d’obtenir 2,5 M€… ou rien du tout.',
        apply: (s, _c, rng) => {
          if (rng.chance(0.5)) {
            addMoney(s, s.userClubId, 'sponsor', 2_500_000, 'Sponsor maillot exceptionnel');
            board(s, 4);
            return 'Coup de poker gagnant : 2,5 M€ !';
          }
          return 'Le sponsor est allé voir ailleurs.';
        },
      },
      {
        label: 'Refuser par principe',
        outcome: 'Moral de l’équipe +3.',
        apply: (s) => {
          teamMorale(s, 3);
          return 'Les supporters saluent votre geste.';
        },
      },
    ],
  },
  {
    id: 'cash-crisis',
    title: 'Le trésorier s’inquiète',
    urgent: true,
    condition: (s) => clubById(s, s.userClubId).balance < 0,
    text: () => 'Les comptes sont dans le rouge. Le trésorier pose trois scénarios sur votre bureau.',
    options: [
      {
        label: 'Couper dans les dépenses',
        outcome: 'Entretien −20 % pendant 10 semaines, moral de l’équipe −4.',
        apply: (s, _c, _r, ids) => {
          modifier(s, ids, 'Plan d’économies', { upkeep: -0.2 }, 10);
          teamMorale(s, -4);
          return 'Plus de déplacements en avion et moins de primes.';
        },
      },
      {
        label: 'Mettre le plus gros salaire en vente',
        outcome: 'Le joueur le mieux payé devient transférable (moral −8).',
        apply: (s) => {
          const p = [...userSquad(s)].sort((a, b) => b.wage - a.wage)[0];
          if (p) {
            p.transferListed = true;
            morale(p, -8);
          }
          return p ? `${fullName(p)} est proposé aux autres clubs.` : '';
        },
      },
      {
        label: 'Demander une rallonge à la direction',
        outcome: '+2 M€, confiance de la direction −8.',
        apply: (s) => {
          addMoney(s, s.userClubId, 'sponsor', 2_000_000, 'Avance de l’actionnaire');
          board(s, -8);
          return 'L’actionnaire remet au pot, mais vous le rappellera.';
        },
      },
    ],
  },
  {
    id: 'board-ultimatum',
    title: 'Ultimatum de la direction',
    urgent: true,
    condition: (s) => s.board.confidence < 28,
    text: () => 'Le président vous convoque : « Les résultats doivent changer, et vite. » Il attend un geste fort.',
    options: [
      {
        label: 'Promettre des résultats immédiats',
        outcome: 'Confiance +6, mais force en match −1 % pendant 2 semaines (pression).',
        apply: (s, _c, _r, ids) => {
          board(s, 6);
          modifier(s, ids, 'Pression du résultat', { matchStrength: -0.01 }, 2);
          return 'Vous avez gagné du temps, rien de plus.';
        },
      },
      {
        label: 'Sacrifier votre adjoint',
        outcome: 'L’adjoint est remercié. Confiance +10, opinion du reste du staff −6.',
        apply: (s, _c, _r, ids) => {
          const a = s.staff.find((m) => m.role === 'assistant');
          if (!a) return 'Vous n’avez pas d’adjoint à sacrifier.';
          s.staff = s.staff.filter((m) => m.id !== a.id);
          s.staff.forEach((m) => opinion(m, -6));
          board(s, 10);
          addNews(s, 'staff', `${name(a)} remercié`, 'Votre adjoint paie les mauvais résultats.', ids);
          return 'La direction obtient sa tête.';
        },
      },
      {
        label: 'Demander du temps',
        outcome: 'Confiance +2.',
        apply: (s) => {
          board(s, 2);
          return 'Le président soupire mais accepte.';
        },
      },
    ],
  },
  {
    id: 'staff-feud',
    title: 'Querelle au sein du staff',
    pickStaff: (s) => s.staff.find((m) => m.traits.includes('hothead') || m.traits.includes('ambitious')),
    pickStaff2: (s, first) => s.staff.filter((m) => m !== first && m.role !== 'scout').sort((a, b) => b.skill - a.skill)[0],
    condition: (s) => s.staff.length >= 3 && s.staff.some((m) => m.traits.includes('hothead') || m.traits.includes('ambitious')),
    text: (c) => `${name(c.staff)} et ${name(c.staff2)} ne se parlent plus depuis une dispute sur la préparation des matchs. Chacun attend que vous tranchiez.`,
    options: [
      {
        label: 'Donner raison au premier',
        outcome: 'Opinion du premier +10, du second −12.',
        apply: (_s, c) => {
          opinion(c.staff, 10);
          opinion(c.staff2, -12);
          return `${name(c.staff)} sort vainqueur de la querelle.`;
        },
      },
      {
        label: 'Donner raison au second',
        outcome: 'Opinion du second +10, du premier −12.',
        apply: (_s, c) => {
          opinion(c.staff2, 10);
          opinion(c.staff, -12);
          return `${name(c.staff2)} sort vainqueur de la querelle.`;
        },
      },
      {
        label: 'Sanctionner les deux',
        outcome: 'Opinion des deux −5, moral de l’équipe +2.',
        apply: (s, c) => {
          opinion(c.staff, -5);
          opinion(c.staff2, -5);
          teamMorale(s, 2);
          return 'Chacun rentre dans le rang.';
        },
      },
    ],
  },
  {
    id: 'transfer-rumor',
    title: 'Rumeur de transfert',
    pickPlayer: (s) => byRating(userSquad(s))[0],
    pickClub: (s) => [...s.clubs].filter((c) => c.id !== s.userClubId).sort((a, b) => b.reputation - a.reputation)[0],
    condition: (s) => userSquad(s).length > 0,
    text: (c) => `La presse affirme que ${c.club?.name ?? 'un géant'} prépare une offre colossale pour ${pname(c)}. Le joueur n'a pas démenti.`,
    options: [
      {
        label: 'Démentir publiquement',
        outcome: 'Moral du joueur −5, confiance de la direction +2.',
        apply: (s, c) => {
          morale(c.player, -5);
          board(s, 2);
          return '« Il n’est pas à vendre. » Point final.';
        },
      },
      {
        label: 'Laisser courir la rumeur',
        outcome: 'Prix de vente +8 % pendant 4 semaines, moral du joueur +5.',
        apply: (s, c, _r, ids) => {
          modifier(s, ids, 'Rumeurs de transfert', { salePrice: 0.08 }, 4);
          morale(c.player, 5);
          return 'Sa cote grimpe sur le marché.';
        },
      },
      {
        label: 'Le convoquer pour le rassurer',
        outcome: 'Moral du joueur +8.',
        apply: (_s, c) => {
          morale(c.player, 8);
          return 'Il se dit heureux au club.';
        },
      },
    ],
  },
  {
    id: 'national-team',
    title: 'Appel en sélection',
    pickPlayer: (s) => byRating(userSquad(s)).find((p) => p.rating >= 74 && p.injuryWeeks === 0),
    condition: (s) => userSquad(s).some((p) => p.rating >= 74 && p.injuryWeeks === 0),
    text: (c) => `${pname(c)} est convoqué par sa sélection pour deux matchs amicaux à l'autre bout du monde.`,
    options: [
      {
        label: 'Le laisser partir',
        outcome: 'Moral du joueur +10, fatigue +18.',
        apply: (_s, c) => {
          morale(c.player, 10);
          if (c.player) c.player.fatigue = clamp(c.player.fatigue + 18, 0, 100);
          return 'Il revient fier… et épuisé.';
        },
      },
      {
        label: 'Négocier avec la fédération',
        outcome: 'Il reste au club : moral du joueur −10.',
        apply: (_s, c) => {
          morale(c.player, -10);
          return 'Il ne digère pas d’avoir manqué la sélection.';
        },
      },
    ],
  },
  {
    id: 'veteran-mentor',
    title: 'Le vieux sage',
    pickPlayer: (s) => [...userSquad(s)].filter((p) => p.age >= 31).sort((a, b) => b.rating - a.rating)[0],
    condition: (s) => userSquad(s).some((p) => p.age >= 31) && youthOf(s, s.userClubId).length > 0,
    text: (c) => `${pname(c)}, ${c.player?.age ?? '?'} ans, propose de rester après l'entraînement pour encadrer les jeunes du centre de formation.`,
    options: [
      {
        label: 'Accepter avec gratitude',
        outcome: 'Progression des jeunes +10 % pendant 12 semaines, moral du vétéran +8, fatigue du vétéran +8.',
        apply: (s, c, _r, ids) => {
          modifier(s, ids, `Tutorat de ${pname(c)}`, { youthGrowth: 0.1 }, 12);
          morale(c.player, 8);
          if (c.player) c.player.fatigue = clamp(c.player.fatigue + 8, 0, 100);
          return 'Les jeunes boivent ses paroles.';
        },
      },
      {
        label: 'Lui demander de se concentrer sur l’équipe première',
        outcome: 'Moral du vétéran −4.',
        apply: (_s, c) => {
          morale(c.player, -4);
          return 'Il s’incline, un peu vexé.';
        },
      },
    ],
  },
  {
    id: 'staff-threat',
    title: 'Un membre du staff menace de démissionner',
    urgent: true,
    pickStaff: (s) => [...s.staff].sort((a, b) => a.opinion - b.opinion)[0],
    condition: (s) => s.staff.some((m) => m.opinion < 25 && !m.traits.includes('loyal')),
    text: (c) => `${name(c.staff)} (${c.staff ? STAFF_ROLE_LABELS[c.staff.role].toLowerCase() : 'staff'}) pose sa lettre de démission sur votre bureau : « Convainquez-moi de rester. »`,
    options: [
      {
        label: 'Augmenter son salaire de 20 %',
        outcome: 'Opinion +20, salaire +20 %.',
        apply: (_s, c) => {
          if (c.staff) c.staff.wage = Math.round(c.staff.wage * 1.2);
          opinion(c.staff, 20);
          return 'La lettre finit à la corbeille.';
        },
      },
      {
        label: 'Lui confier plus de responsabilités',
        outcome: 'Opinion +12 (+20 s’il est Ambitieux).',
        apply: (_s, c) => {
          opinion(c.staff, c.staff?.traits.includes('ambitious') ? 20 : 12);
          return 'Il se sent enfin reconnu.';
        },
      },
      {
        label: 'Accepter sa démission',
        outcome: 'Il quitte le club sans indemnité.',
        apply: (s, c, _r, ids) => {
          if (!c.staff) return '';
          s.staff = s.staff.filter((m) => m.id !== c.staff!.id);
          addNews(s, 'staff', `${name(c.staff)} démissionne`, 'Vous avez accepté sa démission.', ids);
          return 'Bon vent.';
        },
      },
    ],
  },

  // ---------------------------------------------------------------- chaînes et nouveaux dilemmes
  {
    id: 'secret-meeting',
    title: 'Rendez-vous discret',
    pickPlayer: (s) => byRating(userSquad(s)).slice(0, 4)[1] ?? byRating(userSquad(s))[0],
    pickClub: (s) => [...s.clubs].filter((c) => c.id !== s.userClubId).sort((a, b) => b.reputation - a.reputation)[0],
    condition: (s) => userSquad(s).length > 10,
    text: (c) => `Un de vos recruteurs a aperçu ${pname(c)} dîner avec le directeur sportif de ${c.club?.name ?? 'un grand club'}. Personne n'est censé être au courant.`,
    options: [
      {
        label: 'Le confronter',
        outcome: 'Moral du joueur −6, mais l’affaire est étouffée.',
        apply: (_s, c) => {
          morale(c.player, -6);
          return `${pname(c)} jure qu’il ne s’agissait que d’un dîner entre amis.`;
        },
      },
      {
        label: 'Faire comme si de rien n’était',
        outcome: 'Aucun effet immédiat… mais l’histoire pourrait avoir une suite.',
        apply: (s, c) => {
          chain(s, 'transfer-demand', 3, c);
          return 'Vous gardez l’information pour vous.';
        },
      },
      {
        label: 'Le prolonger avant qu’il ne soit trop tard',
        outcome: 'Contrat +2 ans, salaire +25 %, moral +10.',
        apply: (_s, c) => {
          if (c.player) {
            c.player.contractYears += 2;
            c.player.wage = Math.round(c.player.wage * 1.25);
          }
          morale(c.player, 10);
          return `${pname(c)} signe sans hésiter.`;
        },
      },
    ],
  },
  {
    id: 'transfer-demand',
    title: 'Demande de transfert',
    followUp: true,
    text: (c) => `${pname(c)} a demandé officiellement à partir. ${c.club ? `${c.club.name} serait prêt à faire une offre.` : ''} Le vestiaire suit l'affaire de près.`,
    options: [
      {
        label: 'Accepter de le vendre',
        outcome: 'Il est placé sur la liste des transferts ; prix de vente +10 % pendant 4 semaines.',
        apply: (s, c, _r, ids) => {
          if (c.player) c.player.transferListed = true;
          modifier(s, ids, 'Enchères pour une star', { salePrice: 0.1 }, 4);
          return 'Les offres ne vont pas tarder.';
        },
      },
      {
        label: 'Refuser catégoriquement',
        outcome: 'Moral du joueur −20, moral de l’équipe −3, confiance de la direction +3.',
        apply: (s, c) => {
          morale(c.player, -20);
          teamMorale(s, -3);
          board(s, 3);
          return 'Il reste… contre son gré.';
        },
      },
    ],
  },
  {
    id: 'investor',
    title: 'Un investisseur étranger',
    condition: (s) => s.currentWeek >= 4,
    text: () => 'Un fonds d’investissement propose d’entrer au capital du club. L’argent est là, mais ses dirigeants ont la réputation de se mêler de tout.',
    options: [
      {
        label: 'Accepter (+6 M€)',
        outcome: '+6 M€ de trésorerie, budget transferts +3 M€. L’investisseur aura des exigences.',
        apply: (s, c) => {
          addMoney(s, s.userClubId, 'sponsor', 6_000_000, 'Entrée d’un investisseur au capital');
          clubById(s, s.userClubId).transferBudget += 3_000_000;
          chain(s, 'investor-demands', 6, c);
          return 'Les fonds sont versés dans la semaine.';
        },
      },
      {
        label: 'Négocier une minorité de blocage',
        outcome: 'Une chance sur deux : +3 M€ sans contrepartie. Sinon, rien.',
        apply: (s, _c, rng) => {
          if (rng.chance(0.5)) {
            addMoney(s, s.userClubId, 'sponsor', 3_000_000, 'Investisseur minoritaire');
            return 'Accord trouvé : l’argent sans l’ingérence.';
          }
          return 'L’investisseur se retire.';
        },
      },
      {
        label: 'Refuser',
        outcome: 'Moral de l’équipe +2 (les supporters tiennent à l’identité du club).',
        apply: (s) => {
          teamMorale(s, 2);
          return 'Le club reste entre les mains de ses fidèles.';
        },
      },
    ],
  },
  {
    id: 'investor-demands',
    title: 'L’investisseur hausse le ton',
    followUp: true,
    text: () => 'Les représentants de l’investisseur exigent « un nom » pour faire vendre des maillots, et menacent de couper les vivres.',
    options: [
      {
        label: 'Recruter une vedette médiatique',
        outcome: 'Un joueur réputé (et cher) arrive libre sur le marché, déjà bien connu de vos recruteurs. Recettes +5 % pendant 10 semaines.',
        apply: (s, _c, rng, ids) => {
          const star = createPlayer(rng, { id: ids('p'), position: rng.pick(['ST', 'LW', 'RW', 'AM']), meanRating: 78, clubId: null, age: rng.int(28, 32) });
          star.wage = roundMoney(expectedWage(star) * 1.4);
          star.contractYears = 0;
          star.scoutedBy = 'Le carnet d’adresses de l’investisseur';
          s.players.push(star);
          s.scouting.knowledge[star.id] = 90;
          modifier(s, ids, 'Effet vedette', { income: 0.05 }, 10);
          return `${fullName(star)} est disponible : proposez-lui un contrat dans Transferts.`;
        },
      },
      {
        label: 'Leur tenir tête',
        outcome: 'Confiance de la direction −8, opinion de tout le staff +4.',
        apply: (s) => {
          board(s, -8);
          s.staff.forEach((m) => opinion(m, 4));
          return 'Le staff apprécie votre indépendance ; le conseil d’administration beaucoup moins.';
        },
      },
    ],
  },
  {
    id: 'tactical-innovation',
    title: 'Le laboratoire tactique',
    role: 'assistant',
    text: (c) => `${name(c.staff)} a passé ses nuits à disséquer les matchs des meilleurs clubs européens. Il propose de bouleverser vos séances pour intégrer un nouveau système de jeu.`,
    options: [
      {
        label: 'Tenter l’expérience',
        outcome: 'Force en match −2 % pendant 2 semaines le temps de l’apprentissage… puis peut-être un vrai gain.',
        apply: (s, c, _r, ids) => {
          modifier(s, ids, 'Apprentissage du nouveau système', { matchStrength: -0.02 }, 2);
          opinion(c.staff, 8);
          chain(s, 'tactical-innovation-result', 3, c);
          return 'Les joueurs découvrent des séances déroutantes.';
        },
      },
      {
        label: 'Pas en pleine saison',
        outcome: 'Opinion −6.',
        apply: (_s, c) => {
          opinion(c.staff, -6);
          return 'Il range ses schémas dans un tiroir.';
        },
      },
    ],
  },
  {
    id: 'tactical-innovation-result',
    title: 'Le système porte ses fruits ?',
    followUp: true,
    text: (c) => `Trois semaines plus tard, ${name(c.staff)} vous montre les données : les automatismes commencent à prendre. Faut-il aller au bout ?`,
    options: [
      {
        label: 'Généraliser le système',
        outcome: 'Force en match +3 % pendant 8 semaines (la compétence de l’adjoint compte : jusqu’à +4 %).',
        apply: (s, c, _r, ids) => {
          const bonus = (c.staff?.skill ?? 10) >= 15 ? 0.04 : 0.03;
          modifier(s, ids, 'Nouveau système maîtrisé', { matchStrength: bonus }, 8);
          opinion(c.staff, 6);
          return 'L’équipe joue avec une aisance nouvelle.';
        },
      },
      {
        label: 'Revenir aux fondamentaux',
        outcome: 'Moral de l’équipe +3 (les joueurs retrouvent leurs repères), opinion −8.',
        apply: (s, c) => {
          teamMorale(s, 3);
          opinion(c.staff, -8);
          return 'Retour aux bonnes vieilles habitudes.';
        },
      },
    ],
  },
  {
    id: 'documentary',
    title: 'Une plateforme veut filmer le club',
    text: () => 'Une plateforme de streaming propose de suivre le club toute la saison pour une série documentaire, caméras dans le vestiaire comprises.',
    options: [
      {
        label: 'Ouvrir les portes (+800 k€)',
        outcome: '+800 k€, recettes +4 % pendant 12 semaines. Les caméras pourraient capter un moment gênant.',
        apply: (s, c, _r, ids) => {
          addMoney(s, s.userClubId, 'sponsor', 800_000, 'Droits de la série documentaire');
          modifier(s, ids, 'Série documentaire', { income: 0.04 }, 12);
          chain(s, 'documentary-episode', 5, c);
          return 'Le tournage commence lundi.';
        },
      },
      {
        label: 'Refuser',
        outcome: 'Aucun effet.',
        apply: () => 'Le vestiaire restera un sanctuaire.',
      },
    ],
  },
  {
    id: 'documentary-episode',
    title: 'L’épisode qui fait jaser',
    followUp: true,
    pickPlayer: (s) => [...userSquad(s)].sort((a, b) => a.morale - b.morale)[0],
    text: (c) => `Le dernier épisode montre ${pname(c)} critiquer vos choix dans le vestiaire. La séquence tourne en boucle sur les réseaux sociaux.`,
    options: [
      {
        label: 'En rire publiquement',
        outcome: 'Moral de l’équipe +4, confiance de la direction −2.',
        apply: (s) => {
          teamMorale(s, 4);
          board(s, -2);
          return '« Il a peut-être raison », plaisantez-vous en conférence. Le vestiaire apprécie.';
        },
      },
      {
        label: 'Le sanctionner',
        outcome: 'Moral du joueur −12, il est placé sur la liste des transferts.',
        apply: (_s, c) => {
          morale(c.player, -12);
          if (c.player) c.player.transferListed = true;
          return 'Il paie cher son franc-parler.';
        },
      },
      {
        label: 'Exiger le retrait de la séquence',
        outcome: 'Recettes −4 % pendant 4 semaines (la plateforme rompt l’accord).',
        apply: (s, _c, _r, ids) => {
          modifier(s, ids, 'Brouille avec la plateforme', { income: -0.04 }, 4);
          return 'La séquence disparaît… et le partenariat avec.';
        },
      },
    ],
  },
  {
    id: 'nightclub',
    title: 'Nuit agitée',
    pickPlayer: (s) => {
      const party = withTrait(s, 'partygoer');
      if (party.length) return party[s.currentWeek % party.length];
      const squad = userSquad(s).filter((p) => p.age <= 27);
      return squad[Math.floor((s.currentWeek * 7) % Math.max(1, squad.length))];
    },
    condition: (s) => userSquad(s).some((p) => p.age <= 27),
    text: (c) => `Des photos de ${pname(c)} sortant d'une boîte de nuit à 4 heures du matin, la veille de l'entraînement, circulent partout.`,
    options: [
      {
        label: 'Amende salée',
        outcome: 'Moral du joueur −10, moral de l’équipe +2.',
        apply: (s, c) => {
          morale(c.player, -10);
          teamMorale(s, 2);
          return 'Le message est clair pour tout le groupe.';
        },
      },
      {
        label: 'Fermer les yeux',
        outcome: 'Moral du joueur +4… mais il pourrait recommencer.',
        apply: (s, c) => {
          morale(c.player, 4);
          chain(s, 'nightclub-again', 4, c);
          return 'Jeunesse doit se passer.';
        },
      },
      {
        label: 'L’écarter du groupe une semaine',
        outcome: 'Moral du joueur −15, fatigue remise à zéro, opinion de l’adjoint +6.',
        apply: (s, c) => {
          morale(c.player, -15);
          if (c.player) c.player.fatigue = 0;
          opinion(s.staff.find((m) => m.role === 'assistant'), 6);
          return 'Il s’entraînera seul cette semaine.';
        },
      },
    ],
  },
  {
    id: 'nightclub-again',
    title: 'Récidive',
    followUp: true,
    text: (c) => `${pname(c)} a de nouveau été vu en pleine nuit, cette fois deux jours avant un match. Le vestiaire attend de voir si vous allez réagir.`,
    options: [
      {
        label: 'Sanction exemplaire',
        outcome: 'Moral du joueur −20, moral de l’équipe +4, confiance de la direction +2.',
        apply: (s, c) => {
          morale(c.player, -20);
          teamMorale(s, 4);
          board(s, 2);
          return 'Plus personne ne s’y risquera.';
        },
      },
      {
        label: 'Encore une chance',
        outcome: 'Moral de l’équipe −5 : certains y voient du favoritisme.',
        apply: (s) => {
          teamMorale(s, -5);
          return 'Des murmures s’élèvent dans le vestiaire.';
        },
      },
    ],
  },
  {
    id: 'training-brawl',
    title: 'Bagarre à l’entraînement',
    pickPlayer: (s) => byRating(userSquad(s))[2],
    pickPlayer2: (s, first) => [...userSquad(s)].filter((p) => p !== first).sort((a, b) => a.morale - b.morale)[0],
    condition: (s) => userSquad(s).length >= 12,
    text: (c) => `${pname(c)} et ${p2name(c)} en sont venus aux mains après un tacle appuyé. Les autres ont dû les séparer.`,
    options: [
      {
        label: `Donner raison au cadre`,
        outcome: 'Moral du premier +6, du second −12.',
        apply: (_s, c) => {
          morale(c.player, 6);
          morale(c.player2, -12);
          return 'La hiérarchie est respectée.';
        },
      },
      {
        label: 'Sanctionner les deux',
        outcome: 'Moral des deux −6, moral de l’équipe +3.',
        apply: (s, c) => {
          morale(c.player, -6);
          morale(c.player2, -6);
          teamMorale(s, 3);
          return 'Tout le monde a compris.';
        },
      },
      {
        label: 'Organiser une réconciliation',
        outcome: 'Moral des deux +4, l’adjoint perd 2 points d’opinion (il voulait des sanctions).',
        apply: (s, c) => {
          morale(c.player, 4);
          morale(c.player2, 4);
          opinion(s.staff.find((m) => m.role === 'assistant'), -2);
          return 'Une accolade devant le groupe.';
        },
      },
    ],
  },
  {
    id: 'youth-poach',
    title: 'Un géant convoite votre pépite',
    pickPlayer: (s) => [...youthOf(s, s.userClubId), ...userSquad(s).filter((p) => p.age <= 19)].sort((a, b) => b.potential - a.potential)[0],
    pickClub: (s) => [...s.clubs].filter((c) => c.id !== s.userClubId).sort((a, b) => b.reputation - a.reputation)[0],
    condition: (s) => [...youthOf(s, s.userClubId), ...userSquad(s).filter((p) => p.age <= 19)].some((p) => p.potential >= 75),
    text: (c) => `${c.club?.name ?? 'Un grand club'} propose ${millions(youthFee(c.player))} pour ${pname(c)}, ${c.player?.age ?? '?'} ans. La famille du joueur est tentée.`,
    options: [
      {
        label: 'Accepter l’offre',
        outcome: 'Le jeune part ; la somme proposée est versée à la trésorerie.',
        apply: (s, c, _r, ids) => {
          if (!c.player || !c.club) return '';
          const fee = youthFee(c.player);
          addMoney(s, s.userClubId, 'transferOut', fee, `Vente de ${fullName(c.player)}`);
          c.player.clubId = c.club.id;
          c.player.youth = false;
          addNews(s, 'transfer', `${fullName(c.player)} part à ${c.club.name}`, `Transfert de ${millions(fee)}.`, ids);
          return 'Une plus-value spectaculaire pour le centre de formation.';
        },
      },
      {
        label: 'Lui offrir un contrat pro de 4 ans',
        outcome: 'Il rejoint l’effectif professionnel (contrat 4 ans, salaire +50 %), moral +10.',
        apply: (_s, c) => {
          if (c.player) {
            c.player.youth = false;
            c.player.squadStatus = 'prospect';
            c.player.contractYears = 4;
            c.player.wage = Math.round(c.player.wage * 1.5);
          }
          morale(c.player, 10);
          return 'Il signe son premier contrat professionnel.';
        },
      },
      {
        label: 'Refuser sans rien changer',
        outcome: 'Moral du jeune −10.',
        apply: (_s, c) => {
          morale(c.player, -10);
          return 'Il ne comprend pas votre décision.';
        },
      },
    ],
  },
  {
    id: 'super-agent',
    title: 'Le super-agent',
    condition: (s) => clubById(s, s.userClubId).balance > 3_000_000,
    text: () => 'Un agent très influent vous propose « en exclusivité » un international en rupture de contrat. Sa commission n’est pas négociable.',
    options: [
      {
        label: 'Payer la commission (1,5 M€)',
        outcome: 'Un joueur de haut niveau devient libre, parfaitement connu de vos recruteurs.',
        apply: (s, _c, rng, ids) => {
          if (!canPay(s, 1_500_000)) return 'La trésorerie ne le permet pas.';
          addMoney(s, s.userClubId, 'transferIn', -1_500_000, 'Commission d’agent');
          const level = clubById(s, s.userClubId).level;
          const p = createPlayer(rng, { id: ids('p'), position: rng.pick(SQUAD_TEMPLATE), meanRating: 70 + level * 2, clubId: null, age: rng.int(24, 29) });
          p.contractYears = 0;
          p.scoutedBy = 'Le super-agent';
          s.players.push(p);
          s.scouting.knowledge[p.id] = 100;
          return `${fullName(p)} (${p.rating}) vous attend dans Transferts.`;
        },
      },
      {
        label: 'Négocier la commission de moitié',
        outcome: 'Même joueur pour 750 k€.',
        requires: lifestyle('negotiator', 'Négociateur'),
        apply: (s, _c, rng, ids) => {
          if (!canPay(s, 750_000)) return 'La trésorerie ne le permet pas.';
          addMoney(s, s.userClubId, 'transferIn', -750_000, 'Commission d’agent (négociée)');
          const level = clubById(s, s.userClubId).level;
          const p = createPlayer(rng, { id: ids('p'), position: rng.pick(SQUAD_TEMPLATE), meanRating: 70 + level * 2, clubId: null, age: rng.int(24, 29) });
          p.contractYears = 0;
          p.scoutedBy = 'Le super-agent';
          s.players.push(p);
          s.scouting.knowledge[p.id] = 100;
          return `L’agent cède. ${fullName(p)} (${p.rating}) vous attend dans Transferts.`;
        },
      },
      {
        label: 'Décliner poliment',
        outcome: 'Aucun effet.',
        apply: () => 'L’agent ira voir ailleurs.',
      },
      {
        label: 'Le dénoncer à la presse',
        outcome: 'Confiance de la direction +3, exigences salariales +5 % pendant 8 semaines (les agents vous boudent).',
        apply: (s, _c, _r, ids) => {
          board(s, 3);
          modifier(s, ids, 'Agents rancuniers', { wageDemands: 0.05 }, 8);
          return 'Le milieu des agents n’oubliera pas.';
        },
      },
    ],
  },
  {
    id: 'flu',
    title: 'Épidémie de grippe',
    role: 'doctor',
    text: (c) => `Plusieurs joueurs toussent dans le vestiaire. ${name(c.staff)} craint une épidémie avant le prochain match.`,
    options: [
      {
        label: 'Isoler les malades',
        outcome: 'Trois joueurs voient leur fatigue grimper de 30, le reste du groupe est épargné. Opinion du médecin +5.',
        apply: (s, c, rng) => {
          const squad = userSquad(s);
          for (let i = 0; i < 3 && squad.length; i++) {
            const p = squad.splice(rng.int(0, squad.length - 1), 1)[0];
            p.fatigue = clamp(p.fatigue + 30, 0, 100);
          }
          opinion(c.staff, 5);
          return 'Trois joueurs restent à la maison.';
        },
      },
      {
        label: 'Campagne de vaccination (200 k€)',
        outcome: 'Risque de blessure −8 % pendant 8 semaines.',
        apply: (s, _c, _r, ids) => {
          if (!canPay(s, 200_000)) return 'La trésorerie ne le permet pas.';
          pay(s, 200_000, 'Campagne de vaccination');
          modifier(s, ids, 'Groupe vacciné', { injuryRisk: -0.08 }, 8);
          return 'Tout le monde passe à l’infirmerie.';
        },
      },
      {
        label: 'Protocole d’hygiène rigoureux',
        outcome: 'Aucun malade, risque de blessure −4 % pendant 4 semaines.',
        requires: staffTrait('meticulous', 'Staff méticuleux'),
        apply: (s, _c, _r, ids) => {
          modifier(s, ids, 'Protocole sanitaire', { injuryRisk: -0.04 }, 4);
          return 'Gel, masques et vestiaires désinfectés : le virus ne passe pas.';
        },
      },
      {
        label: 'Ne rien faire',
        outcome: 'Toute l’équipe prend +10 de fatigue.',
        apply: (s) => {
          userSquad(s).forEach((p) => (p.fatigue = clamp(p.fatigue + 10, 0, 100)));
          return 'Le virus fait le tour du vestiaire.';
        },
      },
    ],
  },
  {
    id: 'storm',
    title: 'Tempête sur le stade',
    text: (_c, s) => `Une tempête a arraché une partie de la toiture du ${clubById(s, s.userClubId).stadium} et détrempé la pelouse.`,
    options: [
      {
        label: 'Réparations express (400 k€)',
        outcome: 'Aucune conséquence sportive.',
        apply: (s) => {
          if (!canPay(s, 400_000)) return 'La trésorerie ne le permet pas.';
          pay(s, 400_000, 'Réparations après la tempête');
          return 'Les ouvriers travaillent jour et nuit.';
        },
      },
      {
        label: 'Faire avec',
        outcome: 'Risque de blessure +10 % et recettes −5 % pendant 4 semaines.',
        apply: (s, _c, _r, ids) => {
          modifier(s, ids, 'Pelouse abîmée', { injuryRisk: 0.1, income: -0.05 }, 4);
          return 'On jouera sur un terrain lourd.';
        },
      },
    ],
  },
  {
    id: 'legend-returns',
    title: 'Le retour de la légende',
    text: (_c, s) => `Une ancienne gloire de ${clubById(s, s.userClubId).name}, adorée des supporters, propose de revenir comme ambassadeur du club.`,
    options: [
      {
        label: 'L’accueillir (25 k€/sem. pendant 20 semaines)',
        outcome: 'Recettes +4 % et moral +0,5 par semaine pendant 20 semaines. Moral de l’équipe +5.',
        apply: (s, _c, _r, ids) => {
          modifier(s, ids, 'Ambassadeur légendaire', { income: 0.04, morale: 0.5, upkeep: 0.03 }, 20);
          teamMorale(s, 5);
          return 'Standing ovation au stade pour son retour.';
        },
      },
      {
        label: 'Décliner',
        outcome: 'Moral de l’équipe −2.',
        apply: (s) => {
          teamMorale(s, -2);
          return 'Les supporters ne comprennent pas.';
        },
      },
    ],
  },
  {
    id: 'referee',
    title: 'Polémique arbitrale',
    condition: (s) => recentResults(s, 1)[0] === 'L',
    text: () => 'Le dernier match s’est joué sur une décision arbitrale très contestée. Les journalistes attendent votre réaction.',
    options: [
      {
        label: 'Tirer à boulets rouges sur l’arbitre',
        outcome: 'Moral de l’équipe +5, amende de 50 k€, confiance de la direction −2.',
        apply: (s) => {
          pay(s, 50_000, 'Amende de la commission de discipline');
          teamMorale(s, 5);
          board(s, -2);
          return 'Vos joueurs se sentent défendus ; la ligue sort le carnet de chèques.';
        },
      },
      {
        label: 'Rester digne',
        outcome: 'Confiance de la direction +3.',
        apply: (s) => {
          board(s, 3);
          return '« On ne gagne ni ne perd à cause de l’arbitre. »';
        },
      },
    ],
  },
  {
    id: 'homesick',
    title: 'Le mal du pays',
    pickPlayer: (s) => userSquad(s).filter((p) => isNonEu(p)).sort((a, b) => a.morale - b.morale)[0],
    condition: (s) => userSquad(s).some((p) => isNonEu(p) && p.morale < 55),
    text: (c) => `${pname(c)} peine à s'adapter : la langue, le climat, la famille restée au pays. Ses performances s'en ressentent.`,
    options: [
      {
        label: 'Cours de langue et aide à l’installation (60 k€)',
        outcome: 'Moral du joueur +15.',
        apply: (s, c) => {
          if (!canPay(s, 60_000)) return 'La trésorerie ne le permet pas.';
          pay(s, 60_000, 'Accompagnement d’un joueur étranger');
          morale(c.player, 15);
          return 'Il se sent enfin chez lui.';
        },
      },
      {
        label: 'Lui désigner un parrain dans le vestiaire',
        outcome: 'Moral du joueur +8, moral de l’équipe +1.',
        apply: (s, c) => {
          morale(c.player, 8);
          teamMorale(s, 1);
          return 'Un coéquipier le prend sous son aile.';
        },
      },
      {
        label: 'Lui accorder quelques jours chez lui',
        outcome: 'Moral du joueur +12, mais il manque l’entraînement (fatigue remise à zéro, forme −1).',
        apply: (_s, c) => {
          morale(c.player, 12);
          if (c.player) {
            c.player.fatigue = 0;
            c.player.form = clamp(c.player.form - 1, 0, 10);
          }
          return 'Il revient ressourcé.';
        },
      },
    ],
  },
  {
    id: 'board-bonus',
    title: 'La direction est satisfaite',
    condition: (s) => s.board.confidence >= 75 && s.currentWeek >= 6,
    text: () => 'Le président est ravi du parcours et veut vous le montrer. Il vous laisse choisir comment utiliser une enveloppe exceptionnelle.',
    options: [
      {
        label: 'Renforcer le budget transferts',
        outcome: 'Budget transferts +4 M€.',
        apply: (s) => {
          clubById(s, s.userClubId).transferBudget += 4_000_000;
          return 'Le mercato s’annonce animé.';
        },
      },
      {
        label: 'Augmenter la masse salariale',
        outcome: 'Budget salarial +8 %.',
        apply: (s) => {
          const club = clubById(s, s.userClubId);
          club.wageBudget = Math.round(club.wageBudget * 1.08);
          return 'De quoi prolonger vos cadres.';
        },
      },
      {
        label: 'Investir dans le staff',
        outcome: 'Compétence +1 pour deux membres du staff au hasard, opinion de tous +5.',
        apply: (s, _c, rng) => {
          const pool = [...s.staff];
          for (let i = 0; i < 2 && pool.length; i++) {
            const m = pool.splice(rng.int(0, pool.length - 1), 1)[0];
            m.skill = Math.min(20, m.skill + 1);
          }
          s.staff.forEach((m) => opinion(m, 5));
          return 'Formations et nouveaux outils pour tout le staff.';
        },
      },
    ],
  },
  {
    id: 'charity',
    title: 'Gala de charité',
    text: () => 'Une association caritative invite le club à son gala annuel. Les médias seront là.',
    options: [
      {
        label: 'Venir avec tout l’effectif (50 k€)',
        outcome: 'Confiance de la direction +3, moral de l’équipe +3.',
        apply: (s) => {
          pay(s, 50_000, 'Don au gala de charité');
          board(s, 3);
          teamMorale(s, 3);
          return 'Une belle soirée, et de belles photos.';
        },
      },
      {
        label: 'Envoyer le capitaine',
        outcome: 'Moral du meilleur joueur +5.',
        apply: (s) => {
          morale(byRating(userSquad(s))[0], 5);
          return 'Le capitaine représente dignement le club.';
        },
      },
      {
        label: 'Décliner (calendrier chargé)',
        outcome: 'Confiance de la direction −1.',
        apply: (s) => {
          board(s, -1);
          return 'Le président aurait aimé y être vu.';
        },
      },
    ],
  },

  // ---------------------------------------------------------------- vie du club (3e vague)
  {
    id: 'captaincy',
    title: 'Le brassard de capitaine',
    pickPlayer: (s) => [...userSquad(s)].filter((p) => p.age >= 28).sort((a, b) => b.rating - a.rating)[0],
    pickPlayer2: (s, first) => [...userSquad(s)].filter((p) => p !== first && p.age <= 24).sort((a, b) => b.rating - a.rating)[0],
    condition: (s) => s.currentWeek <= 10,
    text: (c) => `Le vestiaire attend votre choix de capitaine. ${pname(c)}, l'expérience, ou ${p2name(c)}, l'avenir du club ?`,
    options: [
      {
        label: 'Le vétéran',
        outcome: 'Moral du vétéran +12, moral de l’équipe +3, moral du jeune −4.',
        apply: (s, c) => {
          morale(c.player, 12);
          morale(c.player2, -4);
          teamMorale(s, 3);
          return `${pname(c)} portera le brassard.`;
        },
      },
      {
        label: 'Le jeune',
        outcome: 'Moral du jeune +15, moral du vétéran −8. Pari sur l’avenir : progression des jeunes +5 % pendant 10 semaines.',
        apply: (s, c, _r, ids) => {
          morale(c.player2, 15);
          morale(c.player, -8);
          modifier(s, ids, 'Un jeune capitaine', { youthGrowth: 0.05 }, 10);
          return `${p2name(c)} devient le plus jeune capitaine de l’histoire récente du club.`;
        },
      },
      {
        label: 'Laisser les joueurs voter',
        outcome: 'Moral de l’équipe +5.',
        apply: (s) => {
          teamMorale(s, 5);
          return 'Le vote désigne un capitaine consensuel.';
        },
      },
    ],
  },
  {
    id: 'pay-rise',
    title: 'Réclamation salariale',
    pickPlayer: (s) => [...userSquad(s)].filter((p) => p.stats.goals + p.stats.assists >= 5).sort((a, b) => b.stats.goals + b.stats.assists - (a.stats.goals + a.stats.assists))[0],
    condition: (s) => userSquad(s).some((p) => p.stats.goals + p.stats.assists >= 5),
    text: (c) => `${pname(c)} enchaîne les performances (${c.player?.stats.goals ?? 0} buts, ${c.player?.stats.assists ?? 0} passes décisives) et estime mériter une revalorisation immédiate.`,
    options: [
      {
        label: 'Augmenter son salaire de 20 %',
        outcome: 'Salaire +20 %, moral +10.',
        apply: (_s, c) => {
          if (c.player) c.player.wage = Math.round(c.player.wage * 1.2);
          morale(c.player, 10);
          return 'Il se sent reconnu à sa juste valeur.';
        },
      },
      {
        label: 'Prime de performance (150 k€ tout de suite)',
        outcome: '−150 k€, moral +6, salaire inchangé.',
        apply: (s, c) => {
          addMoney(s, s.userClubId, 'bonus', -150_000, `Prime de ${pname(c)}`);
          morale(c.player, 6);
          return 'Un compromis apprécié.';
        },
      },
      {
        label: 'Refuser',
        outcome: 'Moral −12. Il pourrait aller plus loin.',
        apply: (s, c) => {
          morale(c.player, -12);
          chain(s, 'training-strike', 2, c);
          return 'Il quitte votre bureau en claquant la porte.';
        },
      },
    ],
  },
  {
    id: 'training-strike',
    title: 'Grève de l’entraînement',
    followUp: true,
    text: (c) => `${pname(c)} ne s'est pas présenté à l'entraînement depuis deux jours. Son agent parle de « désaccord profond ».`,
    options: [
      {
        label: 'Céder : salaire +30 %',
        outcome: 'Salaire +30 %, moral +15, moral de l’équipe −3 (précédent fâcheux).',
        apply: (s, c) => {
          if (c.player) c.player.wage = Math.round(c.player.wage * 1.3);
          morale(c.player, 15);
          teamMorale(s, -3);
          return 'Il revient… et d’autres pourraient s’en inspirer.';
        },
      },
      {
        label: 'Le mettre à pied et le vendre',
        outcome: 'Joueur transférable, moral −10, moral de l’équipe +3, confiance de la direction +2.',
        apply: (s, c) => {
          if (c.player) c.player.transferListed = true;
          morale(c.player, -10);
          teamMorale(s, 3);
          board(s, 2);
          return 'Personne n’est plus grand que le club.';
        },
      },
    ],
  },
  {
    id: 'press-leak',
    title: 'Fuite dans la presse',
    pickStaff: (s) => [...s.staff].sort((a, b) => a.opinion - b.opinion)[0],
    condition: (s) => s.staff.length >= 3,
    text: () => 'Votre composition et votre plan de jeu ont été publiés dans un journal la veille du match. Quelqu’un, au club, parle trop.',
    options: [
      {
        label: 'Mener l’enquête',
        outcome: 'Dans deux semaines, vous saurez qui est la taupe.',
        apply: (s, c) => {
          chain(s, 'mole-found', 2, c);
          return 'Vous restreignez l’accès aux informations sensibles.';
        },
      },
      {
        label: 'Changer de plan au dernier moment',
        outcome: 'Force en match −1 % pendant 1 semaine.',
        apply: (s, _c, _r, ids) => {
          modifier(s, ids, 'Plan improvisé', { matchStrength: -0.01 }, 1);
          return 'Les joueurs découvrent le nouveau plan dans le bus.';
        },
      },
      {
        label: 'Ignorer',
        outcome: 'Force en match −2 % pendant 2 semaines.',
        apply: (s, _c, _r, ids) => {
          modifier(s, ids, 'Adversaires informés', { matchStrength: -0.02 }, 2);
          return 'Vos adversaires lisent le journal.';
        },
      },
    ],
  },
  {
    id: 'mole-found',
    title: 'La taupe démasquée',
    followUp: true,
    text: (c) => `L'enquête est formelle : c'est ${name(c.staff)} qui renseignait un journaliste, par rancœur envers vos méthodes.`,
    options: [
      {
        label: 'Le licencier sur-le-champ',
        outcome: 'Il quitte le club sans indemnité. Opinion du reste du staff +3.',
        apply: (s, c, _r, ids) => {
          if (!c.staff) return '';
          s.staff = s.staff.filter((m) => m.id !== c.staff!.id);
          s.staff.forEach((m) => opinion(m, 3));
          addNews(s, 'staff', `${name(c.staff)} licencié`, 'Il était à l’origine des fuites dans la presse.', ids);
          return 'La confiance revient dans le staff.';
        },
      },
      {
        label: 'Lui donner une seconde chance',
        outcome: 'Opinion +25 (il vous doit tout désormais).',
        apply: (_s, c) => {
          opinion(c.staff, 25);
          return 'Il jure qu’on ne l’y reprendra plus.';
        },
      },
    ],
  },
  {
    id: 'rival-coach',
    title: 'Pique de l’entraîneur adverse',
    pickClub: (s) => nextOpponent(s),
    condition: (s) => !!nextOpponent(s),
    text: (c) => `L'entraîneur de ${c.club?.name ?? 'votre prochain adversaire'} déclare en conférence de presse que votre équipe « joue un football d'un autre temps ».`,
    options: [
      {
        label: 'Répondre du tac au tac',
        outcome: 'Force en match +2 % pendant 1 semaine, moral +4, confiance de la direction −2.',
        apply: (s, _c, _r, ids) => {
          modifier(s, ids, 'Revanche à prendre', { matchStrength: 0.02 }, 1);
          teamMorale(s, 4);
          board(s, -2);
          return '« On en reparlera après le match. »';
        },
      },
      {
        label: 'Afficher l’article dans le vestiaire',
        outcome: 'Force en match +1 % pendant 1 semaine, moral +2.',
        apply: (s, _c, _r, ids) => {
          modifier(s, ids, 'Vexés', { matchStrength: 0.01 }, 1);
          teamMorale(s, 2);
          return 'Vos joueurs ont lu chaque mot.';
        },
      },
      {
        label: 'Ne pas répondre',
        outcome: 'Confiance de la direction +1.',
        apply: (s) => {
          board(s, 1);
          return 'La classe, selon la presse.';
        },
      },
    ],
  },
  {
    id: 'ticket-prices',
    title: 'Le prix des places',
    text: () => 'Le directeur commercial propose de revoir la grille tarifaire du stade. Les supporters suivent le sujet de très près.',
    options: [
      {
        label: 'Augmenter les prix',
        outcome: 'Recettes +8 % pendant 10 semaines, moral de l’équipe −4.',
        apply: (s, _c, _r, ids) => {
          modifier(s, ids, 'Billetterie revue à la hausse', { income: 0.08 }, 10);
          teamMorale(s, -4);
          return 'Les tribunes grondent, la caisse sourit.';
        },
      },
      {
        label: 'Baisser les prix',
        outcome: 'Recettes −5 % pendant 10 semaines, moral de l’équipe +6, moral +0,3 par semaine.',
        apply: (s, _c, _r, ids) => {
          modifier(s, ids, 'Stade populaire', { income: -0.05, morale: 0.3 }, 10);
          teamMorale(s, 6);
          return 'Le stade affiche complet et chante plus fort que jamais.';
        },
      },
      {
        label: 'Ne rien changer',
        outcome: 'Aucun effet.',
        apply: () => 'Statu quo.',
      },
    ],
  },
  {
    id: 'naming',
    title: 'Les droits du nom du stade',
    text: (_c, s) => `Une multinationale propose 3 M€ pour rebaptiser le ${clubById(s, s.userClubId).stadium} à son nom pendant cinq ans.`,
    options: [
      {
        label: 'Accepter (+3 M€)',
        outcome: '+3 M€, le stade change de nom, moral de l’équipe −3.',
        apply: (s) => {
          const club = clubById(s, s.userClubId);
          addMoney(s, s.userClubId, 'sponsor', 3_000_000, 'Droits de dénomination du stade');
          club.stadium = `${['Nexora', 'Velto', 'Orbia', 'Kandor'][s.currentWeek % 4]} Arena`;
          teamMorale(s, -3);
          return `Bienvenue à la ${club.stadium}.`;
        },
      },
      {
        label: 'Refuser',
        outcome: 'Moral de l’équipe +2.',
        apply: (s) => {
          teamMorale(s, 2);
          return 'Le stade garde son nom historique.';
        },
      },
    ],
  },
  {
    id: 'kit',
    title: 'Le nouveau maillot',
    text: () => 'L’équipementier présente deux projets de maillot : un audacieux, un classique.',
    options: [
      {
        label: 'Le maillot audacieux',
        outcome: 'Une chance sur deux : recettes +6 % pendant 8 semaines ; sinon moral −3.',
        apply: (s, _c, rng, ids) => {
          if (rng.chance(0.5)) {
            modifier(s, ids, 'Maillot à succès', { income: 0.06 }, 8);
            return 'Rupture de stock en 48 heures !';
          }
          teamMorale(s, -3);
          return 'Les supporters le trouvent affreux.';
        },
      },
      {
        label: 'Le classique',
        outcome: 'Recettes +2 % pendant 8 semaines.',
        apply: (s, _c, _r, ids) => {
          modifier(s, ids, 'Maillot traditionnel', { income: 0.02 }, 8);
          return 'Une valeur sûre.';
        },
      },
    ],
  },
  {
    id: 'medical-error',
    title: 'Erreur de diagnostic',
    role: 'doctor',
    pickPlayer: (s) => userSquad(s).find((p) => p.injuryWeeks > 0),
    condition: (s) => userSquad(s).some((p) => p.injuryWeeks > 0),
    text: (c) => `Un spécialiste extérieur contredit ${name(c.staff)} : la blessure de ${pname(c)} était mal soignée et son indisponibilité s'allonge.`,
    options: [
      {
        label: 'Licencier le médecin',
        outcome: 'Le médecin part (8 semaines d’indemnité), moral du joueur +5.',
        apply: (s, c, _r, ids) => {
          if (c.staff) {
            pay(s, c.staff.wage * 8, `Indemnité de ${name(c.staff)}`);
            s.staff = s.staff.filter((m) => m.id !== c.staff!.id);
            addNews(s, 'staff', `${name(c.staff)} licencié`, 'Erreur médicale.', ids);
          }
          if (c.player) c.player.injuryWeeks += 1;
          morale(c.player, 5);
          return 'Le poste de médecin est à pourvoir.';
        },
      },
      {
        label: 'Avertissement et second avis systématique',
        outcome: 'Indisponibilité +2 semaines, opinion du médecin −10, durée des blessures −10 % pendant 10 semaines.',
        apply: (s, c, _r, ids) => {
          if (c.player) c.player.injuryWeeks += 2;
          opinion(c.staff, -10);
          modifier(s, ids, 'Second avis médical', { injuryDuration: -0.1 }, 10);
          return 'Les protocoles sont revus.';
        },
      },
    ],
  },
  {
    id: 'new-father',
    title: 'Heureux événement',
    pickPlayer: (s) => [...userSquad(s)].filter((p) => p.age >= 24)[s.currentWeek % Math.max(1, userSquad(s).filter((p) => p.age >= 24).length)],
    condition: (s) => userSquad(s).some((p) => p.age >= 24),
    text: (c) => `${pname(c)} vient de devenir papa ! Il vous demande quelques jours pour être auprès de sa famille.`,
    options: [
      {
        label: 'Accorder une semaine de congé',
        outcome: 'Moral du joueur +15, fatigue remise à zéro, forme −1.',
        apply: (_s, c) => {
          morale(c.player, 15);
          if (c.player) {
            c.player.fatigue = 0;
            c.player.form = clamp(c.player.form - 1, 0, 10);
          }
          return 'Il reviendra le cœur léger.';
        },
      },
      {
        label: 'Le féliciter, mais il joue ce week-end',
        outcome: 'Moral du joueur +3.',
        apply: (_s, c) => {
          morale(c.player, 3);
          return 'Il comprend, sans grand enthousiasme.';
        },
      },
    ],
  },
  {
    id: 'release-clause',
    title: 'L’agent veut une clause',
    pickPlayer: (s) => byRating(userSquad(s)).slice(0, 6).find((p) => p.releaseClause === null),
    condition: (s) => byRating(userSquad(s)).slice(0, 6).some((p) => p.releaseClause === null),
    text: (c) => `L'agent de ${pname(c)} réclame l'ajout d'une clause libératoire « pour rassurer son client sur son avenir ».`,
    options: [
      {
        label: 'Clause élevée (2× sa valeur)',
        outcome: 'Moral +6. Un club pourra le recruter en payant ce montant.',
        apply: (_s, c) => {
          if (c.player) c.player.releaseClause = roundMoney(marketValue(c.player) * 2);
          morale(c.player, 6);
          return 'Clause ajoutée au contrat.';
        },
      },
      {
        label: 'Clause accessible (1,3× sa valeur)',
        outcome: 'Moral +14, mais le joueur devient une cible facile.',
        apply: (_s, c) => {
          if (c.player) c.player.releaseClause = roundMoney(marketValue(c.player) * 1.3);
          morale(c.player, 14);
          return 'L’agent repart ravi.';
        },
      },
      {
        label: 'Refuser',
        outcome: 'Moral −8.',
        apply: (_s, c) => {
          morale(c.player, -8);
          return 'Pas de clause, pas de discussion.';
        },
      },
    ],
  },
  {
    id: 'data-platform',
    title: 'La révolution des données',
    text: () => 'Une start-up propose une plateforme d’analyse vidéo et statistique utilisée par les plus grands clubs.',
    options: [
      {
        label: 'Abonnement complet (300 k€)',
        outcome: 'Fiabilité des rapports +10 et force en match +1 % pendant 12 semaines.',
        apply: (s, _c, _r, ids) => {
          if (!canPay(s, 300_000)) return 'La trésorerie ne le permet pas.';
          pay(s, 300_000, 'Plateforme d’analyse de données');
          modifier(s, ids, 'Analyse de données', { scoutAccuracy: 10, matchStrength: 0.01 }, 12);
          return 'Vos analystes découvrent leurs nouveaux tableaux de bord.';
        },
      },
      {
        label: 'Version d’essai gratuite',
        outcome: 'Fiabilité des rapports +5 pendant 4 semaines.',
        apply: (s, _c, _r, ids) => {
          modifier(s, ids, 'Essai de la plateforme', { scoutAccuracy: 5 }, 4);
          return 'Un mois pour se faire une idée.';
        },
      },
      {
        label: 'Décliner',
        outcome: 'Aucun effet.',
        apply: () => 'Le football se joue sur le terrain, pas dans un tableur.',
      },
    ],
  },
  {
    id: 'heatwave',
    title: 'Canicule',
    role: 'fitness',
    condition: (s) => s.currentWeek <= 6,
    text: (c) => `Il fait 38 °C au centre d'entraînement. ${name(c.staff)} s'inquiète pour la santé des joueurs.`,
    options: [
      {
        label: 'S’entraîner à l’aube',
        outcome: 'Récupération +10 % pendant 3 semaines, opinion du préparateur +5.',
        apply: (s, c, _r, ids) => {
          modifier(s, ids, 'Séances à la fraîche', { recovery: 0.1 }, 3);
          opinion(c.staff, 5);
          return 'Réveil à 5 heures pour tout le monde.';
        },
      },
      {
        label: 'Alléger la charge',
        outcome: 'Fatigue −10 pour tout l’effectif, force en match −1 % pendant 1 semaine.',
        apply: (s, _c, _r, ids) => {
          userSquad(s).forEach((p) => (p.fatigue = clamp(p.fatigue - 10, 0, 100)));
          modifier(s, ids, 'Préparation allégée', { matchStrength: -0.01 }, 1);
          return 'Séances courtes et beaucoup d’eau.';
        },
      },
      {
        label: 'Maintenir le programme',
        outcome: 'Risque de blessure +8 % pendant 2 semaines, opinion du préparateur −6.',
        apply: (s, c, _r, ids) => {
          modifier(s, ids, 'Organismes éprouvés', { injuryRisk: 0.08 }, 2);
          opinion(c.staff, -6);
          return 'Les joueurs souffrent en silence.';
        },
      },
    ],
  },
  {
    id: 'cup-rotation',
    title: 'Fièvre de coupe',
    condition: (s) => nextFixture(s)?.competition === 'cup',
    pickClub: (s) => nextOpponent(s),
    text: (c) => `Match de coupe en vue contre ${c.club?.name ?? 'votre adversaire'}. Faut-il aligner l'équipe type ou faire tourner ?`,
    options: [
      {
        label: 'Équipe type, on vise le trophée',
        outcome: 'Force en match +2 % pendant 1 semaine, risque de blessure +5 % pendant 1 semaine.',
        apply: (s, _c, _r, ids) => {
          modifier(s, ids, 'Objectif coupe', { matchStrength: 0.02, injuryRisk: 0.05 }, 1);
          return 'Les cadres sont prévenus : pas de calcul.';
        },
      },
      {
        label: 'Faire souffler les cadres',
        outcome: 'Fatigue −20 pour les 6 meilleurs joueurs, moral des remplaçants +5.',
        apply: (s) => {
          const ranked = byRating(userSquad(s));
          ranked.slice(0, 6).forEach((p) => (p.fatigue = clamp(p.fatigue - 20, 0, 100)));
          ranked.slice(11).forEach((p) => morale(p, 5));
          return 'Les remplaçants auront leur chance.';
        },
      },
    ],
  },
  {
    id: 'scout-headhunted',
    title: 'Un recruteur courtisé',
    role: 'scout',
    pickStaff: (s) => [...s.staff].filter((m) => m.role === 'scout').sort((a, b) => b.skill - a.skill)[0],
    condition: (s) => s.staff.some((m) => m.role === 'scout' && !m.missionId && !m.traits.includes('loyal')),
    text: (c) => `Un club rival propose à ${name(c.staff)} de diriger sa cellule de recrutement.`,
    options: [
      {
        label: 'Contre-offre : salaire +25 %',
        outcome: 'Il reste, opinion +12.',
        apply: (_s, c) => {
          if (c.staff) c.staff.wage = Math.round(c.staff.wage * 1.25);
          opinion(c.staff, 12);
          return 'Il signe pour rester.';
        },
      },
      {
        label: 'Lui promettre plus de moyens',
        outcome: 'Il reste si son opinion dépasse 55, sinon il part. Qualité des boosters +2 pendant 10 semaines s’il reste.',
        apply: (s, c, _r, ids) => {
          if (!c.staff) return '';
          if (c.staff.opinion > 55) {
            modifier(s, ids, 'Cellule de recrutement renforcée', { boosterQuality: 2 }, 10);
            return 'Il reste, motivé par le projet.';
          }
          s.staff = s.staff.filter((m) => m.id !== c.staff!.id);
          addNews(s, 'staff', `${name(c.staff)} s’en va`, 'Votre recruteur a rejoint un rival.', ids);
          return 'Il préfère partir.';
        },
      },
      {
        label: 'Le laisser partir',
        outcome: 'Il quitte le club.',
        apply: (s, c, _r, ids) => {
          if (!c.staff) return '';
          s.staff = s.staff.filter((m) => m.id !== c.staff!.id);
          addNews(s, 'staff', `${name(c.staff)} s’en va`, 'Votre recruteur a rejoint un rival.', ids);
          return 'Bonne chance à lui.';
        },
      },
    ],
  },

  // ---------------------------------------------------------------- 4e vague (options réservées, chaîne en trois actes)
  {
    id: 'prodigy-tip',
    title: 'Le gamin du club de quartier',
    role: 'scout',
    text: (c) => `${name(c.staff)} revient d'un tournoi amateur, intarissable sur un gamin de 15 ans « qui joue comme s'il avait des yeux dans le dos ». Il faudrait l'inviter à un essai.`,
    options: [
      {
        label: 'Organiser un essai (50 k€)',
        outcome: 'Dans deux semaines, vous verrez le phénomène à l’œuvre.',
        apply: (s, c) => {
          if (!canPay(s, 50_000)) return 'La trésorerie ne le permet pas.';
          pay(s, 50_000, 'Essai d’un jeune amateur');
          chain(s, 'prodigy-trial', 2, c);
          opinion(c.staff, 5);
          return 'La famille accepte l’invitation.';
        },
      },
      {
        label: 'Pas le temps',
        outcome: 'Opinion du recruteur −5.',
        apply: (_s, c) => {
          opinion(c.staff, -5);
          return 'Le recruteur range son carnet, déçu.';
        },
      },
    ],
  },
  {
    id: 'prodigy-trial',
    title: 'L’essai du prodige',
    followUp: true,
    text: (c) => `Le gamin repéré par ${name(c.staff)} a éclaboussé la séance de son talent. Vos éducateurs sont unanimes, mais un grand club rôde déjà.`,
    options: [
      {
        label: 'L’intégrer au centre de formation',
        outcome: 'Un jeune au potentiel exceptionnel rejoint le centre. Un rival pourrait tenter de vous le prendre.',
        apply: (s, c, rng, ids) => {
          const level = clubById(s, s.userClubId).facilities.academy;
          const p = createPlayer(rng, { id: ids('p'), position: rng.pick(['ST', 'AM', 'LW', 'RW', 'CM']), meanRating: 46 + level * 2, clubId: s.userClubId, age: 15 });
          p.rating = clamp(p.rating, 42, 60);
          p.potential = clamp(p.rating + rng.int(28, 38), p.rating, 95);
          p.youth = true;
          p.homegrownClubId = s.userClubId;
          p.squadStatus = 'prospect';
          p.wage = roundMoney(400 + level * 150);
          p.contractYears = 3;
          p.releaseClause = null;
          s.players.push(p);
          chain(s, 'prodigy-rival', 6, { ...c, player: p });
          addNews(s, 'youth', `${fullName(p)} rejoint le centre`, `Repéré dans un club amateur par ${name(c.staff)}.`, ids);
          return `${fullName(p)} signe sa licence au club.`;
        },
      },
      {
        label: 'Le laisser mûrir dans son club',
        outcome: 'Aucun effet. Opinion du recruteur −8.',
        apply: (_s, c) => {
          opinion(c.staff, -8);
          return 'Le gamin retourne jouer avec ses copains.';
        },
      },
    ],
  },
  {
    id: 'prodigy-rival',
    title: 'On veut vous voler votre pépite',
    followUp: true,
    pickClub: (s) => [...s.clubs].filter((c) => c.id !== s.userClubId).sort((a, b) => b.reputation - a.reputation)[0],
    text: (c) => `${c.club?.name ?? 'Un grand club'} a approché la famille de ${pname(c)} : logement, études payées, salaire pour les parents. La famille hésite.`,
    options: [
      {
        label: 'Contrat aspirant renforcé (300 k€)',
        outcome: 'Il reste. Moral +15, contrat porté à 4 ans.',
        apply: (s, c) => {
          if (!canPay(s, 300_000)) return 'La trésorerie ne le permet pas.';
          pay(s, 300_000, 'Prime à la signature d’un aspirant');
          if (c.player) c.player.contractYears = 4;
          morale(c.player, 15);
          return 'La famille choisit la stabilité.';
        },
      },
      {
        label: 'Convaincre la famille en personne',
        outcome: 'Il reste. Moral +10, opinion de tout le staff +3.',
        requires: lifestyle('mentor', 'Mentor'),
        apply: (s, c) => {
          morale(c.player, 10);
          s.staff.forEach((m) => opinion(m, 3));
          return 'Votre réputation de formateur fait la différence.';
        },
      },
      {
        label: 'Le vendre au prix fort',
        outcome: 'Il part ; vous touchez 2 à 4 M€.',
        apply: (s, c, rng, ids) => {
          if (!c.player || !c.club) return '';
          const fee = roundMoney(rng.int(20, 40) * 100_000);
          addMoney(s, s.userClubId, 'transferOut', fee, `Vente de ${fullName(c.player)}`);
          c.player.clubId = c.club.id;
          c.player.youth = false;
          addNews(s, 'transfer', `${fullName(c.player)} part à ${c.club.name}`, `Transfert de ${millions(fee)}.`, ids);
          return 'Une jolie somme, et des regrets peut-être.';
        },
      },
    ],
  },
  {
    id: 'ultras',
    title: 'Les ultras montent au créneau',
    text: () => 'Le groupe de supporters le plus influent menace de boycotter le prochain match à domicile : il réclame des places moins chères et un local dans le stade.',
    options: [
      {
        label: 'Leur céder un local',
        outcome: 'Moral de l’équipe +4, moral +0,3 par semaine pendant 8 semaines, confiance de la direction −2.',
        apply: (s, _c, _r, ids) => {
          teamMorale(s, 4);
          modifier(s, ids, 'Kop en fusion', { morale: 0.3 }, 8);
          board(s, -2);
          return 'Le kop chante de nouveau.';
        },
      },
      {
        label: 'Trouver un compromis',
        outcome: 'Moral de l’équipe +5, recettes +3 % pendant 8 semaines.',
        requires: lifestyle('negotiator', 'Négociateur'),
        apply: (s, _c, _r, ids) => {
          teamMorale(s, 5);
          modifier(s, ids, 'Accord avec les supporters', { income: 0.03 }, 8);
          return 'Tout le monde y trouve son compte.';
        },
      },
      {
        label: 'Exclure les meneurs',
        outcome: 'Confiance de la direction +3, recettes −5 % pendant 6 semaines, moral −3.',
        apply: (s, _c, _r, ids) => {
          board(s, 3);
          modifier(s, ids, 'Tribune clairsemée', { income: -0.05 }, 6);
          teamMorale(s, -3);
          return 'Le virage reste à moitié vide.';
        },
      },
    ],
  },
  {
    id: 'mayor',
    title: 'Le maire veut vous aider',
    condition: (s) => s.currentWeek >= 4,
    text: (_c, s) => `En pleine campagne électorale, le maire propose une subvention pour moderniser le ${clubById(s, s.userClubId).stadium}… à condition de poser à vos côtés.`,
    options: [
      {
        label: 'Accepter la subvention (+2 M€)',
        outcome: '+2 M€, entretien −10 % pendant 20 semaines. Moral de l’équipe −1 (récupération politique).',
        apply: (s, _c, _r, ids) => {
          addMoney(s, s.userClubId, 'sponsor', 2_000_000, 'Subvention municipale');
          modifier(s, ids, 'Équipements rénovés par la ville', { upkeep: -0.1 }, 20);
          teamMorale(s, -1);
          return 'La photo fait la une du journal local.';
        },
      },
      {
        label: 'Rester neutre',
        outcome: 'Confiance de la direction +1.',
        apply: (s) => {
          board(s, 1);
          return 'Le club ne fait pas de politique.';
        },
      },
    ],
  },
  {
    id: 'old-boy',
    title: 'Le retour de l’enfant prodigue',
    condition: (s) => userSquad(s).length < 30,
    text: (_c, s) => `Un ancien international formé à ${clubById(s, s.userClubId).name}, 34 ans, rentre d'une longue carrière à l'étranger. Il voudrait finir au club, pour un salaire symbolique.`,
    options: [
      {
        label: 'L’accueillir (contrat d’un an)',
        outcome: 'Un vétéran expérimenté rejoint l’effectif, moral de l’équipe +4.',
        apply: (s, _c, rng, ids) => {
          const club = clubById(s, s.userClubId);
          const p = createPlayer(rng, { id: ids('p'), position: rng.pick(['CB', 'CM', 'DM', 'ST']), meanRating: 66 + club.level * 2, clubId: club.id, age: 34 });
          p.potential = p.rating;
          p.wage = roundMoney(expectedWage(p) * 0.4);
          p.contractYears = 1;
          p.homegrownClubId = club.id;
          p.squadStatus = 'rotation';
          p.morale = 90;
          s.players.push(p);
          teamMorale(s, 4);
          addNews(s, 'transfer', `${fullName(p)} est de retour`, 'L’enfant du club revient boucler la boucle.', ids);
          return `${fullName(p)} retrouve le vestiaire de ses débuts.`;
        },
      },
      {
        label: 'Lui proposer un rôle d’ambassadeur',
        outcome: 'Recettes +3 % pendant 10 semaines.',
        apply: (s, _c, _r, ids) => {
          modifier(s, ids, 'Ambassadeur du club', { income: 0.03 }, 10);
          return 'Il fera le lien avec les partenaires.';
        },
      },
      {
        label: 'Décliner',
        outcome: 'Moral de l’équipe −2.',
        apply: (s) => {
          teamMorale(s, -2);
          return 'Une partie du vestiaire ne comprend pas.';
        },
      },
    ],
  },
  {
    id: 'tactical-debate',
    title: 'Désaccord tactique',
    role: 'assistant',
    text: (c) => `En pleine séance vidéo, ${name(c.staff)} conteste ouvertement vos choix devant les joueurs.`,
    options: [
      {
        label: 'Le recadrer en privé',
        outcome: 'Opinion −6, moral de l’équipe +1.',
        apply: (s, c) => {
          opinion(c.staff, -6);
          teamMorale(s, 1);
          return 'L’autorité est préservée.';
        },
      },
      {
        label: 'Démontrer votre plan au tableau',
        outcome: 'Opinion +8, force en match +2 % pendant 3 semaines.',
        requires: lifestyle('tactician', 'Tacticien'),
        apply: (s, c, _r, ids) => {
          opinion(c.staff, 8);
          modifier(s, ids, 'Plan limpide', { matchStrength: 0.02 }, 3);
          return 'Votre démonstration convainc tout le monde, adjoint compris.';
        },
      },
      {
        label: 'Écouter ses arguments',
        outcome: 'Opinion +6, moral de l’équipe −2.',
        apply: (s, c) => {
          opinion(c.staff, 6);
          teamMorale(s, -2);
          return 'Certains joueurs y voient un aveu de faiblesse.';
        },
      },
    ],
  },
  {
    id: 'social-media',
    title: 'Le message de trop',
    pickPlayer: (s) => [...userSquad(s)].filter((p) => p.age <= 25).sort((a, b) => a.morale - b.morale)[0],
    condition: (s) => userSquad(s).some((p) => p.age <= 25),
    text: (c) => `${pname(c)} a publié un message ambigu sur les réseaux sociaux après sa dernière sortie sur le banc. Les supporters s'enflamment.`,
    options: [
      {
        label: 'Lui faire supprimer et s’excuser',
        outcome: 'Moral du joueur −6, confiance de la direction +2.',
        apply: (s, c) => {
          morale(c.player, -6);
          board(s, 2);
          return 'Le message disparaît, les excuses arrivent.';
        },
      },
      {
        label: 'Le défendre publiquement',
        outcome: 'Moral du joueur +10, confiance de la direction −2.',
        apply: (s, c) => {
          morale(c.player, 10);
          board(s, -2);
          return '« C’est un jeune qui a envie de jouer, c’est plutôt bon signe. »';
        },
      },
      {
        label: 'Le prendre sous votre aile',
        outcome: 'Moral du joueur +12, progression des jeunes +5 % pendant 6 semaines.',
        requires: lifestyle('mentor', 'Mentor'),
        apply: (s, c, _r, ids) => {
          morale(c.player, 12);
          modifier(s, ids, 'Le coach à l’écoute', { youthGrowth: 0.05 }, 6);
          return 'Une longue discussion, et un joueur transformé.';
        },
      },
    ],
  },
  {
    id: 'injury-crisis',
    title: 'Hécatombe à l’infirmerie',
    urgent: true,
    condition: (s) => userSquad(s).filter((p) => p.injuryWeeks > 0).length >= 4,
    text: (_c, s) => `${userSquad(s).filter((p) => p.injuryWeeks > 0).length} joueurs sont à l'infirmerie. Le staff médical est débordé.`,
    options: [
      {
        label: 'Renforts médicaux temporaires (200 k€)',
        outcome: 'Durée des blessures −15 % pendant 6 semaines.',
        apply: (s, _c, _r, ids) => {
          if (!canPay(s, 200_000)) return 'La trésorerie ne le permet pas.';
          pay(s, 200_000, 'Kinés et médecins en renfort');
          modifier(s, ids, 'Cellule médicale renforcée', { injuryDuration: -0.15 }, 6);
          return 'Deux kinés et un médecin rejoignent le staff pour un mois et demi.';
        },
      },
      {
        label: 'Faire appel aux jeunes',
        outcome: 'Les deux meilleurs jeunes du centre passent pros (statut Espoir), moral +12.',
        apply: (s) => {
          const youth = [...youthOf(s, s.userClubId)].sort((a, b) => b.rating - a.rating).slice(0, 2);
          youth.forEach((p) => {
            p.youth = false;
            p.squadStatus = 'prospect';
            morale(p, 12);
          });
          return youth.length ? `${youth.map(fullName).join(' et ')} découvrent le vestiaire pro.` : 'Le centre de formation est vide.';
        },
      },
      {
        label: 'Alléger les entraînements',
        outcome: 'Risque de blessure −10 % pendant 3 semaines, force en match −1 % pendant 3 semaines.',
        apply: (s, _c, _r, ids) => {
          modifier(s, ids, 'Charge allégée', { injuryRisk: -0.1, matchStrength: -0.01 }, 3);
          return 'Moins d’intensité, moins de casse.';
        },
      },
    ],
  },
  {
    id: 'summer-tour',
    title: 'Tournée à l’étranger',
    condition: (s) => s.currentWeek <= 8,
    text: () => 'Un organisateur propose une tournée de matchs amicaux à l’autre bout du monde pendant la trêve internationale.',
    options: [
      {
        label: 'Partir en tournée (+700 k€)',
        outcome: '+700 k€, recettes +3 % pendant 8 semaines, fatigue +12 pour tout l’effectif.',
        apply: (s, _c, _r, ids) => {
          addMoney(s, s.userClubId, 'sponsor', 700_000, 'Tournée internationale');
          modifier(s, ids, 'Notoriété à l’étranger', { income: 0.03 }, 8);
          userSquad(s).forEach((p) => (p.fatigue = clamp(p.fatigue + 12, 0, 100)));
          return 'Les joueurs reviennent épuisés mais la marque a voyagé.';
        },
      },
      {
        label: 'Stage de cohésion au calme',
        outcome: 'Moral de l’équipe +5, fatigue −10.',
        apply: (s) => {
          teamMorale(s, 5);
          userSquad(s).forEach((p) => (p.fatigue = clamp(p.fatigue - 10, 0, 100)));
          return 'Une semaine au vert, loin des caméras.';
        },
      },
    ],
  },
  {
    id: 'kit-man',
    title: 'Le départ de l’intendant',
    text: (_c, s) => `L'intendant de ${clubById(s, s.userClubId).name}, au club depuis 32 ans, prend sa retraite. Tout le vestiaire l'adore.`,
    options: [
      {
        label: 'Organiser une cérémonie (20 k€)',
        outcome: 'Moral de l’équipe +6.',
        apply: (s) => {
          pay(s, 20_000, 'Cérémonie de départ');
          teamMorale(s, 6);
          return 'Haie d’honneur et maillot floqué à son nom.';
        },
      },
      {
        label: 'Un simple pot de départ',
        outcome: 'Moral de l’équipe +2.',
        apply: (s) => {
          teamMorale(s, 2);
          return 'Quelques mots et beaucoup d’émotion.';
        },
      },
    ],
  },
  {
    id: 'rival-spree',
    title: 'Le rival casse sa tirelire',
    pickClub: (s) => [...s.clubs].filter((c) => c.id !== s.userClubId).sort((a, b) => b.reputation - a.reputation)[0],
    text: (c) => `${c.club?.name ?? 'Votre grand rival'} vient d'aligner trois recrues de prestige. La presse parle d'un championnat déjà joué.`,
    options: [
      {
        label: 'Demander une rallonge à la direction',
        outcome: 'Budget transferts +3 M€, confiance de la direction −5.',
        apply: (s) => {
          clubById(s, s.userClubId).transferBudget += 3_000_000;
          board(s, -5);
          return 'Le président s’exécute, en soupirant.';
        },
      },
      {
        label: 'Jouer les outsiders',
        outcome: 'Moral de l’équipe +5, force en match +1 % pendant 4 semaines.',
        apply: (s, _c, _r, ids) => {
          teamMorale(s, 5);
          modifier(s, ids, 'Rôle d’outsider', { matchStrength: 0.01 }, 4);
          return '« Qu’ils prennent la pression, nous on joue. »';
        },
      },
      {
        label: 'Activer votre réseau',
        outcome: 'Rabais sur les indemnités +10 % pendant 6 semaines.',
        requires: staffTrait('diplomat', 'Staff diplomate'),
        apply: (s, _c, _r, ids) => {
          modifier(s, ids, 'Carnet d’adresses', { feeDiscount: 0.1 }, 6);
          return 'Votre diplomate décroche son téléphone.';
        },
      },
    ],
  },
  {
    id: 'youth-tournament',
    title: 'Tournoi international de jeunes',
    role: 'youth',
    condition: (s) => youthOf(s, s.userClubId).length >= 3,
    text: (c) => `${name(c.staff)} voudrait emmener vos jeunes à un prestigieux tournoi international.`,
    options: [
      {
        label: 'Les y envoyer (80 k€)',
        outcome: 'Progression des jeunes +10 % pendant 6 semaines, moral des jeunes +8, opinion +5.',
        apply: (s, c, _r, ids) => {
          if (!canPay(s, 80_000)) return 'La trésorerie ne le permet pas.';
          pay(s, 80_000, 'Tournoi international de jeunes');
          modifier(s, ids, 'Expérience internationale', { youthGrowth: 0.1 }, 6);
          youthOf(s, s.userClubId).forEach((p) => morale(p, 8));
          opinion(c.staff, 5);
          return 'Vos jeunes reviennent avec une coupe… et de l’ambition.';
        },
      },
      {
        label: 'Pas cette année',
        outcome: 'Opinion −4.',
        apply: (_s, c) => {
          opinion(c.staff, -4);
          return 'Une autre fois peut-être.';
        },
      },
    ],
  },
  {
    id: 'staff-contract',
    title: 'Fin de contrat dans le staff',
    pickStaff: (s) => s.staff.find((m) => m.contractYears <= 1),
    condition: (s) => s.staff.some((m) => m.contractYears <= 1),
    text: (c) => `Le contrat de ${name(c.staff)} (${c.staff ? STAFF_ROLE_LABELS[c.staff.role].toLowerCase() : 'staff'}) arrive à son terme. Il attend un signe de votre part.`,
    options: [
      {
        label: 'Prolonger de 2 ans (+10 %)',
        outcome: 'Contrat +2 ans, salaire +10 %, opinion +10.',
        apply: (_s, c) => {
          if (c.staff) {
            c.staff.contractYears += 2;
            c.staff.wage = Math.round(c.staff.wage * 1.1);
          }
          opinion(c.staff, 10);
          return 'Signature dans la foulée.';
        },
      },
      {
        label: 'Attendre la fin de saison',
        outcome: 'Opinion −8.',
        apply: (_s, c) => {
          opinion(c.staff, -8);
          return 'Il se sent peu considéré.';
        },
      },
    ],
  },
  {
    id: 'season-finale',
    title: 'Dernière ligne droite',
    condition: (s) => s.currentWeek >= s.weeks.length - 4,
    text: (_c, s) => `Plus que quelques journées. Vous êtes ${leaguePosition(s)}e : c'est le moment de trouver les mots justes.`,
    options: [
      {
        label: 'Promettre une prime collective',
        outcome: 'Force en match +2 % pendant 3 semaines, −300 k€.',
        apply: (s, _c, _r, ids) => {
          addMoney(s, s.userClubId, 'bonus', -300_000, 'Prime de fin de saison');
          modifier(s, ids, 'Prime à la clé', { matchStrength: 0.02 }, 3);
          return 'Chacun sait ce qu’il a à gagner.';
        },
      },
      {
        label: 'Faire tourner pour préparer la suite',
        outcome: 'Fatigue −15 pour tout l’effectif, progression des jeunes +5 % pendant 4 semaines.',
        apply: (s, _c, _r, ids) => {
          userSquad(s).forEach((p) => (p.fatigue = clamp(p.fatigue - 15, 0, 100)));
          modifier(s, ids, 'Temps de jeu pour les jeunes', { youthGrowth: 0.05 }, 4);
          return 'Place aux jeunes et aux remplaçants.';
        },
      },
      {
        label: 'Rien ne change',
        outcome: 'Aucun effet.',
        apply: () => 'On continue comme avant.',
      },
    ],
  },

  // ---------------------------------------------------------------- scénarios de joueurs (personnalités, rivalités, trajectoires)
  {
    id: 'position-battle',
    title: 'Duel pour une place',
    pickPlayer: (s) => positionRivals(s)?.[0],
    pickPlayer2: (s) => positionRivals(s)?.[1],
    condition: (s) => !!positionRivals(s),
    text: (c) => `${pname(c)} et ${p2name(c)} se disputent le poste de ${c.player ? POSITION_LABELS[c.player.position] : 'titulaire'}. À l'entraînement, chaque duel tourne à la guerre. Il faut trancher.`,
    options: [
      {
        label: 'Titulariser le premier',
        outcome: 'Moral du premier +8 (statut Titulaire), du second −10. Le second pourrait mal le vivre.',
        apply: (s, c) => {
          if (c.player) c.player.squadStatus = 'regular';
          morale(c.player, 8);
          morale(c.player2, -10);
          chain(s, 'battle-aftermath', 4, { ...c, player: c.player2, player2: c.player });
          return `${pname(c)} gagne sa place.`;
        },
      },
      {
        label: 'Titulariser le second',
        outcome: 'Moral du second +8 (statut Titulaire), du premier −10. Le premier pourrait mal le vivre.',
        apply: (s, c) => {
          if (c.player2) c.player2.squadStatus = 'regular';
          morale(c.player2, 8);
          morale(c.player, -10);
          chain(s, 'battle-aftermath', 4, c);
          return `${p2name(c)} gagne sa place.`;
        },
      },
      {
        label: 'Concurrence ouverte',
        outcome: 'Moral des deux −2, force en match +1 % pendant 4 semaines (chacun se surpasse).',
        apply: (s, c, _r, ids) => {
          morale(c.player, -2);
          morale(c.player2, -2);
          modifier(s, ids, 'Concurrence saine', { matchStrength: 0.01 }, 4);
          return 'Le meilleur jouera, semaine après semaine.';
        },
      },
    ],
  },
  {
    id: 'battle-aftermath',
    title: 'Le remplaçant ronge son frein',
    followUp: true,
    text: (c) => `Depuis qu'il a perdu sa place au profit de ${p2name(c)}, ${pname(c)} traîne les pieds à l'entraînement.`,
    options: [
      {
        label: 'Lui promettre du temps de jeu',
        outcome: 'Statut Rotation, moral +10.',
        apply: (_s, c) => {
          if (c.player) c.player.squadStatus = 'rotation';
          morale(c.player, 10);
          return 'Il retrouve le sourire.';
        },
      },
      {
        label: 'Il accepte son rôle pour le bien du club',
        outcome: 'Moral +5, moral de l’équipe +3.',
        requires: playerTrait('loyal'),
        apply: (s, c) => {
          morale(c.player, 5);
          teamMorale(s, 3);
          return 'Un exemple d’abnégation salué par tout le vestiaire.';
        },
      },
      {
        label: 'Le placer sur la liste des transferts',
        outcome: 'Joueur transférable, moral +4.',
        apply: (_s, c) => {
          if (c.player) c.player.transferListed = true;
          morale(c.player, 4);
          return 'Il ira chercher du temps de jeu ailleurs.';
        },
      },
    ],
  },
  {
    id: 'goal-drought',
    title: 'Panne sèche',
    pickPlayer: (s) => byRating(userSquad(s)).find((p) => POSITION_GROUP[p.position] === 'ATT' && p.stats.appearances >= 5 && p.stats.goals <= Math.floor(p.stats.appearances / 6)),
    condition: (s) => userSquad(s).some((p) => POSITION_GROUP[p.position] === 'ATT' && p.stats.appearances >= 5 && p.stats.goals <= Math.floor(p.stats.appearances / 6)),
    text: (c) => `${pname(c)} n'a marqué que ${c.player?.stats.goals ?? 0} but(s) en ${c.player?.stats.appearances ?? 0} matchs. La presse le surnomme déjà « l'homme qui ne marque plus ».`,
    options: [
      {
        label: 'Lui maintenir votre confiance',
        outcome: 'Il reste titulaire. Dans trois semaines : délivrance… ou rechute.',
        apply: (s, c, rng) => {
          morale(c.player, 6);
          const odds = 0.55 + (hasTrait(c.player, 'clutch') ? 0.2 : 0) + (hasTrait(c.player, 'introvert') ? -0.1 : 0);
          chain(s, rng.chance(odds) ? 'drought-end' : 'drought-continues', 3, c);
          return '« Il va marquer, j’en suis certain. »';
        },
      },
      {
        label: 'Préparateur mental (120 k€)',
        outcome: 'Moral +10, forme +1,5.',
        apply: (s, c) => {
          if (!canPay(s, 120_000)) return 'La trésorerie ne le permet pas.';
          pay(s, 120_000, 'Préparateur mental');
          morale(c.player, 10);
          if (c.player) c.player.form = clamp(c.player.form + 1.5, 0, 10);
          return 'Il travaille sur sa confiance devant le but.';
        },
      },
      {
        label: 'Le mettre sur le banc',
        outcome: 'Statut Rotation, moral −8.',
        apply: (_s, c) => {
          if (c.player) c.player.squadStatus = 'rotation';
          morale(c.player, -8);
          return 'Un électrochoc… ou une sanction.';
        },
      },
    ],
  },
  {
    id: 'drought-end',
    title: 'La délivrance',
    followUp: true,
    text: (c) => `${pname(c)} a enfin retrouvé le chemin des filets ! Il a couru vers le banc pour vous serrer dans ses bras.`,
    options: [
      {
        label: 'Savourer avec lui',
        outcome: 'Moral +15, forme +2, moral de l’équipe +3. Il gagne le trait « Décisif ».',
        apply: (s, c) => {
          morale(c.player, 15);
          if (c.player) c.player.form = clamp(c.player.form + 2, 0, 10);
          teamMorale(s, 3);
          setTraits(c.player, ['clutch']);
          return 'Une confiance retrouvée pour de bon.';
        },
      },
      {
        label: 'Garder la tête froide',
        outcome: 'Moral +8, forme +1.',
        apply: (_s, c) => {
          morale(c.player, 8);
          if (c.player) c.player.form = clamp(c.player.form + 1, 0, 10);
          return '« Ce n’est qu’un but. Le prochain, maintenant. »';
        },
      },
    ],
  },
  {
    id: 'drought-continues',
    title: 'La disette continue',
    followUp: true,
    text: (c) => `Trois semaines de plus sans marquer. ${pname(c)} ne célèbre même plus les buts de ses coéquipiers.`,
    options: [
      {
        label: 'Insister encore',
        outcome: 'Moral −4, forme −1. Le groupe doute (moral de l’équipe −2).',
        apply: (s, c) => {
          morale(c.player, -4);
          if (c.player) c.player.form = clamp(c.player.form - 1, 0, 10);
          teamMorale(s, -2);
          return 'Votre entêtement divise.';
        },
      },
      {
        label: 'Le laisser souffler',
        outcome: 'Statut Rotation, fatigue remise à zéro, moral +2.',
        apply: (_s, c) => {
          if (c.player) {
            c.player.squadStatus = 'rotation';
            c.player.fatigue = 0;
          }
          morale(c.player, 2);
          return 'Quelques semaines pour se ressourcer.';
        },
      },
    ],
  },
  {
    id: 'golden-boy',
    title: 'L’homme en forme',
    pickPlayer: (s) => byRating(userSquad(s)).find((p) => p.stats.goals >= 6),
    condition: (s) => userSquad(s).some((p) => p.stats.goals >= 6),
    text: (c) => `${c.player?.stats.goals ?? 0} buts déjà pour ${pname(c)} ! Les télévisions se l'arrachent et son nom circule dans les plus grands clubs.`,
    options: [
      {
        label: 'Le protéger des médias',
        outcome: 'Moral +5, forme +1.',
        apply: (s, c) => {
          morale(c.player, 5);
          if (c.player) c.player.form = clamp(c.player.form + 1, 0, 10);
          chain(s, 'golden-offer', 6, c);
          return 'Silence radio : il se concentre sur le terrain.';
        },
      },
      {
        label: 'Le laisser enchaîner les plateaux',
        outcome: 'Recettes +4 % pendant 6 semaines, forme −1. Les offres risquent d’arriver plus vite.',
        apply: (s, c, _r, ids) => {
          modifier(s, ids, 'Star médiatique', { income: 0.04 }, 6);
          if (c.player) c.player.form = clamp(c.player.form - 1, 0, 10);
          chain(s, 'golden-offer', 3, c);
          return 'Son visage est partout.';
        },
      },
    ],
  },
  {
    id: 'golden-offer',
    title: 'L’offre qu’on ne refuse pas ?',
    followUp: true,
    pickClub: (s) => [...s.clubs].filter((c) => c.id !== s.userClubId).sort((a, b) => b.reputation - a.reputation)[0],
    text: (c) => `${c.club?.name ?? 'Un géant'} propose ${c.player ? millions(roundMoney(marketValue(c.player) * 2.5)) : 'une fortune'} pour ${pname(c)}. Le joueur attend votre réponse, fébrile.`,
    options: [
      {
        label: 'Accepter l’offre',
        outcome: 'Il part ; vous encaissez 2,5 fois sa valeur. Moral de l’équipe −3.',
        apply: (s, c, _r, ids) => {
          if (!c.player || !c.club) return '';
          const fee = roundMoney(marketValue(c.player) * 2.5);
          addMoney(s, s.userClubId, 'transferOut', fee, `Vente de ${fullName(c.player)}`);
          const club = clubById(s, s.userClubId);
          club.tactic.lineup = club.tactic.lineup.map((id) => (id === c.player!.id ? null : id));
          c.player.clubId = c.club.id;
          c.player.transferListed = false;
          teamMorale(s, -3);
          addNews(s, 'transfer', `${fullName(c.player)} part à ${c.club.name}`, `Transfert record de ${millions(fee)}.`, ids);
          return 'Un chèque historique.';
        },
      },
      {
        label: 'Prolonger et augmenter (+40 %)',
        outcome: 'Contrat +2 ans, salaire +40 %, moral +12.',
        apply: (_s, c) => {
          if (c.player) {
            c.player.contractYears += 2;
            c.player.wage = Math.round(c.player.wage * 1.4);
          }
          morale(c.player, 12);
          return 'Il devient le joueur le mieux payé de l’histoire du club.';
        },
      },
      {
        label: 'Refuser net',
        outcome: 'Moral −15 (−3 seulement s’il est Fidèle).',
        apply: (_s, c) => {
          morale(c.player, hasTrait(c.player, 'loyal') ? -3 : -15);
          return hasTrait(c.player, 'loyal') ? 'Il comprend : son cœur est ici.' : 'Il ne vous le pardonnera pas de sitôt.';
        },
      },
    ],
  },
  {
    id: 'inseparable',
    title: 'Les inséparables',
    pickPlayer: (s) => {
      const squad = userSquad(s);
      return squad.find((a) => squad.some((b) => b !== a && b.nationality === a.nationality && a.nationality !== 'FRA'));
    },
    pickPlayer2: (s, first) => userSquad(s).find((b) => first && b !== first && b.nationality === first.nationality),
    condition: (s) => {
      const squad = userSquad(s);
      return squad.some((a) => squad.some((b) => b !== a && b.nationality === a.nationality && a.nationality !== 'FRA'));
    },
    text: (c) => `${pname(c)} et ${p2name(c)}, compatriotes, ne se quittent plus : mêmes repas, même voiture, même coin du vestiaire. Certains parlent de clan.`,
    options: [
      {
        label: 'Les associer sur le terrain',
        outcome: 'Moral des deux +6, force en match +1 % pendant 4 semaines.',
        apply: (s, c, _r, ids) => {
          morale(c.player, 6);
          morale(c.player2, 6);
          modifier(s, ids, `Le duo ${c.player?.lastName ?? ''}-${c.player2?.lastName ?? ''}`, { matchStrength: 0.01 }, 4);
          return 'Leur complicité saute aux yeux.';
        },
      },
      {
        label: 'Les obliger à s’ouvrir au groupe',
        outcome: 'Moral des deux −4, moral de l’équipe +3.',
        apply: (s, c) => {
          morale(c.player, -4);
          morale(c.player2, -4);
          teamMorale(s, 3);
          return 'Les tables du réfectoire sont redistribuées.';
        },
      },
    ],
  },
  {
    id: 'apprentice',
    title: 'Le maître et l’élève',
    pickPlayer: (s) => [...userSquad(s)].filter((p) => p.age >= 29 && (hasTrait(p, 'professional') || hasTrait(p, 'leader'))).sort((a, b) => b.rating - a.rating)[0],
    pickPlayer2: (s, first) => [...userSquad(s)].filter((p) => p !== first && p.age <= 21 && p.potential - p.rating >= 8 && first && p.position.slice(-1) === first.position.slice(-1)).sort((a, b) => b.potential - a.potential)[0] ?? [...userSquad(s)].filter((p) => p !== first && p.age <= 21).sort((a, b) => b.potential - a.potential)[0],
    condition: (s) => userSquad(s).some((p) => p.age >= 29 && (hasTrait(p, 'professional') || hasTrait(p, 'leader'))) && userSquad(s).some((p) => p.age <= 21),
    text: (c) => `${pname(c)}, ${c.player?.age ?? '?'} ans, a pris ${p2name(c)} sous son aile : séances supplémentaires, analyse vidéo, conseils de vie. Il vous demande d'officialiser ce tutorat.`,
    options: [
      {
        label: 'Officialiser le tutorat',
        outcome: 'Moral des deux +6. Dans huit semaines, l’élève aura progressé.',
        apply: (s, c) => {
          morale(c.player, 6);
          morale(c.player2, 6);
          chain(s, 'apprentice-graduation', 8, c);
          return 'Un binôme se forme.';
        },
      },
      {
        label: 'Chacun son programme',
        outcome: 'Moral du vétéran −4.',
        apply: (_s, c) => {
          morale(c.player, -4);
          return 'Le vétéran s’en tient à son propre travail.';
        },
      },
    ],
  },
  {
    id: 'apprentice-graduation',
    title: 'L’élève a grandi',
    followUp: true,
    text: (c) => `Huit semaines de travail avec ${pname(c)} ont transformé ${p2name(c)} : plus mûr, plus juste dans ses choix, il a pris le trait « Professionnel ».`,
    options: [
      {
        label: 'Lui donner plus de responsabilités',
        outcome: 'Note +2, potentiel +2, statut Rotation, moral +10.',
        apply: (_s, c) => {
          if (c.player2) {
            c.player2.rating = Math.min(c.player2.potential + 2, c.player2.rating + 2);
            c.player2.potential = Math.min(95, c.player2.potential + 2);
            c.player2.squadStatus = 'rotation';
          }
          setTraits(c.player2, ['professional']);
          morale(c.player2, 10);
          return 'Il est prêt pour le haut niveau.';
        },
      },
      {
        label: 'Le féliciter et rester patient',
        outcome: 'Note +2, potentiel +2, moral +4. Le vétéran gagne le trait « Meneur ».',
        apply: (_s, c) => {
          if (c.player2) {
            c.player2.rating = Math.min(c.player2.potential + 2, c.player2.rating + 2);
            c.player2.potential = Math.min(95, c.player2.potential + 2);
          }
          setTraits(c.player2, ['professional']);
          setTraits(c.player, ['leader']);
          morale(c.player2, 4);
          return 'Le maître est fier de son élève.';
        },
      },
    ],
  },
  {
    id: 'penalty-dispute',
    title: 'Qui tire les penaltys ?',
    pickPlayer: (s) => byRating(userSquad(s)).filter((p) => POSITION_GROUP[p.position] !== 'DEF' && p.position !== 'GK')[0],
    pickPlayer2: (s, first) => byRating(userSquad(s)).filter((p) => p !== first && POSITION_GROUP[p.position] !== 'DEF' && p.position !== 'GK')[0],
    condition: (s) => userSquad(s).length >= 14,
    text: (c) => `Dispute devant tout le stade : ${pname(c)} et ${p2name(c)} se sont arraché le ballon avant un penalty. Il faut désigner un tireur attitré.`,
    options: [
      {
        label: 'Le premier',
        outcome: 'Moral du premier +6, du second −6.',
        apply: (_s, c) => {
          morale(c.player, 6);
          morale(c.player2, -6);
          return `${pname(c)} sera le tireur.`;
        },
      },
      {
        label: 'Le second',
        outcome: 'Moral du second +6, du premier −6.',
        apply: (_s, c) => {
          morale(c.player2, 6);
          morale(c.player, -6);
          return `${p2name(c)} sera le tireur.`;
        },
      },
      {
        label: 'Laisser le meneur du vestiaire trancher',
        outcome: 'Moral de l’équipe +4, aucun froissé.',
        requires: { label: 'Un Meneur dans l’effectif', test: (s) => withTrait(s, 'leader').length > 0 },
        apply: (s) => {
          teamMorale(s, 4);
          return `${fullName(withTrait(s, 'leader')[0])} règle l’affaire en deux phrases.`;
        },
      },
    ],
  },
  {
    id: 'position-change',
    title: 'Il se voit avant-centre',
    pickPlayer: (s) => byRating(userSquad(s)).find((p) => ['LW', 'RW', 'AM'].includes(p.position) && hasTrait(p, 'ambitious')) ?? byRating(userSquad(s)).find((p) => ['LW', 'RW', 'AM'].includes(p.position)),
    condition: (s) => userSquad(s).some((p) => ['LW', 'RW', 'AM'].includes(p.position)),
    text: (c) => `${pname(c)} (${c.player ? POSITION_LABELS[c.player.position] : '?'}) est persuadé d'être un avant-centre dans l'âme et réclame de jouer en pointe.`,
    options: [
      {
        label: 'Le replacer en pointe',
        outcome: 'Son poste devient avant-centre (BU), moral +12.',
        apply: (_s, c) => {
          if (c.player) c.player.position = 'ST';
          morale(c.player, 12);
          return 'Nouveau poste, nouvelle vie.';
        },
      },
      {
        label: 'Refuser',
        outcome: 'Moral −8.',
        apply: (_s, c) => {
          morale(c.player, -8);
          return 'Il reste sur son couloir, frustré.';
        },
      },
    ],
  },
  {
    id: 'golden-exile',
    title: 'Le pont d’or',
    pickPlayer: (s) => byRating(userSquad(s)).slice(0, 6).find((p) => p.age >= 29),
    condition: (s) => byRating(userSquad(s)).slice(0, 6).some((p) => p.age >= 29),
    text: (c) => `Un championnat exotique offre à ${pname(c)} un salaire cinq fois supérieur au sien. À ${c.player?.age ?? '?'} ans, c'est le contrat de sa vie.`,
    options: [
      {
        label: 'Le laisser partir',
        outcome: 'Il quitte le club ; vous touchez 1,5 fois sa valeur.',
        apply: (s, c, _r, ids) => {
          if (!c.player) return '';
          const fee = roundMoney(marketValue(c.player) * 1.5);
          addMoney(s, s.userClubId, 'transferOut', fee, `Départ de ${fullName(c.player)} à l’étranger`);
          addNews(s, 'transfer', `${fullName(c.player)} s’exile`, `Indemnité de ${millions(fee)}.`, ids);
          leaveClub(s, c.player);
          return 'Bon vent, et merci pour tout.';
        },
      },
      {
        label: 'S’aligner (salaire +50 %)',
        outcome: 'Salaire +50 %, contrat +1 an, moral +10.',
        apply: (_s, c) => {
          if (c.player) {
            c.player.wage = Math.round(c.player.wage * 1.5);
            c.player.contractYears += 1;
          }
          morale(c.player, 10);
          return 'Il reste, au prix fort.';
        },
      },
      {
        label: 'Faire appel à son cœur',
        outcome: 'Il reste sans augmentation. Moral +5, moral de l’équipe +4.',
        requires: playerTrait('loyal'),
        apply: (s, c) => {
          morale(c.player, 5);
          teamMorale(s, 4);
          return '« L’argent ne fait pas tout. Ici, c’est chez moi. »';
        },
      },
    ],
  },
  {
    id: 'the-brother',
    title: 'Le petit frère',
    pickPlayer: (s) => byRating(userSquad(s)).find((p) => p.age >= 23),
    condition: (s) => userSquad(s).length < 30,
    text: (c) => `${pname(c)} vous parle de son petit frère, joueur dans un club de division inférieure : « Donnez-lui sa chance, vous ne le regretterez pas. »`,
    options: [
      {
        label: 'Le faire signer',
        outcome: 'Le frère rejoint l’effectif (contrat de 2 ans, petit salaire). Moral du joueur +12.',
        apply: (s, c, rng, ids) => {
          if (!c.player) return '';
          const level = clubById(s, s.userClubId).level;
          const b = createPlayer(rng, { id: ids('p'), position: rng.pick(SQUAD_TEMPLATE), meanRating: 54 + level * 2, clubId: s.userClubId, age: Math.max(17, c.player.age - rng.int(2, 5)) });
          b.lastName = c.player.lastName;
          b.nationality = c.player.nationality;
          b.potential = clamp(b.rating + rng.int(4, 14), b.rating, 90);
          b.wage = roundMoney(expectedWage(b) * 0.7);
          b.contractYears = 2;
          b.squadStatus = 'backup';
          s.players.push(b);
          morale(c.player, 12);
          addNews(s, 'transfer', `${fullName(b)} rejoint son frère`, `Les frères ${b.lastName} sont réunis au club.`, ids);
          return `${fullName(b)} signe au club.`;
        },
      },
      {
        label: 'Lui proposer un essai',
        outcome: 'Moral du joueur +4.',
        apply: (_s, c) => {
          morale(c.player, 4);
          return 'L’essai ne débouche sur rien, mais le geste est apprécié.';
        },
      },
      {
        label: 'Refuser',
        outcome: 'Moral du joueur −6.',
        apply: (_s, c) => {
          morale(c.player, -6);
          return 'Il espérait mieux de votre part.';
        },
      },
    ],
  },
  {
    id: 'leader-speech',
    title: 'Le meneur prend la parole',
    urgent: true,
    pickPlayer: (s) => withTrait(s, 'leader')[0],
    condition: (s) => streak(s, 'L') >= 2 && withTrait(s, 'leader').length > 0,
    text: (c) => `Après deux défaites, ${pname(c)} demande à parler seul au groupe, sans le staff.`,
    options: [
      {
        label: 'Lui laisser le vestiaire',
        outcome: 'Moral de l’équipe +7, moral du joueur +5.',
        apply: (s, c) => {
          teamMorale(s, 7);
          morale(c.player, 5);
          return 'Personne ne saura ce qui s’est dit, mais les visages ont changé.';
        },
      },
      {
        label: 'Garder la main',
        outcome: 'Moral du joueur −5.',
        apply: (_s, c) => {
          morale(c.player, -5);
          return '« C’est à moi de parler. »';
        },
      },
    ],
  },
  {
    id: 'temper',
    title: 'Coup de sang',
    pickPlayer: (s) => withTrait(s, 'temperamental')[0],
    condition: (s) => withTrait(s, 'temperamental').length > 0,
    text: (c) => `Remplacé à l'heure de jeu, ${pname(c)} a frappé dans une glacière et refusé de vous serrer la main devant les caméras.`,
    options: [
      {
        label: 'Amende et excuses publiques',
        outcome: 'Moral −8, moral de l’équipe +2.',
        apply: (s, c) => {
          morale(c.player, -8);
          teamMorale(s, 2);
          return 'Les excuses arrivent, du bout des lèvres.';
        },
      },
      {
        label: 'Préparation mentale (100 k€)',
        outcome: 'Il perd le trait « Sanguin » et gagne « Professionnel ». Moral +4.',
        apply: (s, c) => {
          if (!canPay(s, 100_000)) return 'La trésorerie ne le permet pas.';
          pay(s, 100_000, 'Préparation mentale');
          setTraits(c.player, ['professional'], ['temperamental']);
          morale(c.player, 4);
          return 'Un travail de fond qui portera ses fruits.';
        },
      },
      {
        label: 'Comprendre sa frustration',
        outcome: 'Moral +6, confiance de la direction −2.',
        apply: (s, c) => {
          morale(c.player, 6);
          board(s, -2);
          return '« Il veut jouer, c’est une bonne chose. »';
        },
      },
    ],
  },
  {
    id: 'prank',
    title: 'La blague de trop ?',
    pickPlayer: (s) => withTrait(s, 'joker')[0],
    condition: (s) => withTrait(s, 'joker').length > 0 && s.staff.length > 0,
    pickStaff: (s) => s.staff[0],
    text: (c) => `${pname(c)} a rempli la voiture de ${name(c.staff)} de ballons de baudruche. Tout le vestiaire est mort de rire. Lui, beaucoup moins.`,
    options: [
      {
        label: 'En rire avec le groupe',
        outcome: 'Moral de l’équipe +5, opinion du membre du staff −6.',
        apply: (s, c) => {
          teamMorale(s, 5);
          opinion(c.staff, -6);
          return 'Une photo qui fera le tour des réseaux du club.';
        },
      },
      {
        label: 'Sanctionner le farceur',
        outcome: 'Moral du joueur −6, opinion du membre du staff +5.',
        apply: (_s, c) => {
          morale(c.player, -6);
          opinion(c.staff, 5);
          return 'La récréation est terminée.';
        },
      },
    ],
  },
  {
    id: 'shy-talent',
    title: 'Le talent discret',
    pickPlayer: (s) => [...userSquad(s)].filter((p) => hasTrait(p, 'introvert') && p.age <= 24).sort((a, b) => b.potential - a.potential)[0],
    condition: (s) => userSquad(s).some((p) => hasTrait(p, 'introvert') && p.age <= 24),
    text: (c) => `${pname(c)} brille à l'entraînement mais se cache en match. Votre adjoint pense qu'il manque simplement de confiance.`,
    options: [
      {
        label: 'Tête-à-tête dans votre bureau',
        outcome: 'Moral +12. Une chance sur deux qu’il perde le trait « Discret ».',
        apply: (_s, c, rng) => {
          morale(c.player, 12);
          if (rng.chance(0.5)) {
            setTraits(c.player, [], ['introvert']);
            return 'Il ressort transformé, plus sûr de lui.';
          }
          return 'Il vous a écouté, poliment.';
        },
      },
      {
        label: 'Le lancer comme titulaire',
        outcome: 'Statut Titulaire, moral +8, forme +1.',
        apply: (_s, c) => {
          if (c.player) {
            c.player.squadStatus = 'regular';
            c.player.form = clamp(c.player.form + 1, 0, 10);
          }
          morale(c.player, 8);
          return 'Rien de tel que la confiance du coach.';
        },
      },
    ],
  },
  {
    id: 'fan-favorite',
    title: 'Le chouchou des tribunes',
    pickPlayer: (s) => [...userSquad(s)].filter((p) => (p.squadStatus === 'backup' || p.squadStatus === 'rotation') && (hasTrait(p, 'loyal') || hasTrait(p, 'joker') || p.age >= 30))[0],
    condition: (s) => userSquad(s).some((p) => (p.squadStatus === 'backup' || p.squadStatus === 'rotation') && (hasTrait(p, 'loyal') || hasTrait(p, 'joker') || p.age >= 30)),
    text: (c) => `Tout le stade a scandé le nom de ${pname(c)}, cantonné au banc, pendant le dernier match. La pression monte.`,
    options: [
      {
        label: 'Lui offrir une titularisation',
        outcome: 'Statut Titulaire, moral +12, moral de l’équipe +3.',
        apply: (s, c) => {
          if (c.player) c.player.squadStatus = 'regular';
          morale(c.player, 12);
          teamMorale(s, 3);
          return 'Le stade va exploser à l’annonce de la composition.';
        },
      },
      {
        label: 'Les choix sportifs d’abord',
        outcome: 'Moral de l’équipe −2, confiance de la direction +1.',
        apply: (s) => {
          teamMorale(s, -2);
          board(s, 1);
          return 'Quelques sifflets lors de l’annonce des équipes.';
        },
      },
    ],
  },
  {
    id: 'new-agent',
    title: 'Le nouvel agent',
    pickPlayer: (s) => byRating(userSquad(s)).slice(0, 8).find((p) => hasTrait(p, 'ambitious')) ?? byRating(userSquad(s))[3],
    condition: (s) => userSquad(s).length >= 12,
    text: (c) => `${pname(c)} vient de confier ses intérêts à un agent réputé pour ses méthodes agressives. Première exigence : une revalorisation immédiate.`,
    options: [
      {
        label: 'Accepter (+15 %)',
        outcome: 'Salaire +15 %, moral +6.',
        apply: (_s, c) => {
          if (c.player) c.player.wage = Math.round(c.player.wage * 1.15);
          morale(c.player, 6);
          return 'L’agent obtient sa première victoire.';
        },
      },
      {
        label: 'Refuser de négocier avec lui',
        outcome: 'Moral −10, discussions bloquées 6 semaines.',
        apply: (s, c) => {
          morale(c.player, -10);
          if (c.player) c.player.talksBlockedUntil = s.season * 100 + s.currentWeek + 6;
          return 'La porte est fermée.';
        },
      },
      {
        label: 'Retourner l’agent à votre avantage',
        outcome: 'Aucune augmentation ; exigences salariales −5 % pendant 8 semaines.',
        requires: lifestyle('negotiator', 'Négociateur'),
        apply: (s, _c, _r, ids) => {
          modifier(s, ids, 'L’agent devient un allié', { wageDemands: -0.05 }, 8);
          return 'L’agent repart avec… trois autres clients à vous présenter.';
        },
      },
    ],
  },

  // ---------------------------------------------------------------- 5e vague : trajectoires de joueurs
  {
    id: 'clans',
    title: 'Deux clans dans le vestiaire',
    pickPlayer: (s) => withTrait(s, 'leader')[0] ?? byRating(userSquad(s))[0],
    pickPlayer2: (s, first) => [...withTrait(s, 'ambitious'), ...withTrait(s, 'temperamental')].find((p) => p !== first) ?? byRating(userSquad(s))[1],
    condition: (s) => withTrait(s, 'ambitious').length + withTrait(s, 'temperamental').length > 0 && userSquad(s).length >= 14,
    text: (c) => `Le vestiaire s'est coupé en deux : d'un côté ceux qui suivent ${pname(c)}, de l'autre la bande de ${p2name(c)}. Les repas se prennent à deux tables.`,
    options: [
      {
        label: `Soutenir le clan du premier`,
        outcome: 'Moral du premier +8, du second −12. Le second pourrait envenimer les choses.',
        apply: (s, c) => {
          morale(c.player, 8);
          morale(c.player2, -12);
          chain(s, 'clan-war', 4, { ...c, player: c.player2, player2: c.player });
          return 'Le rapport de force bascule.';
        },
      },
      {
        label: 'Réunion de crise avec les deux',
        outcome: 'Moral des deux +3, moral de l’équipe +4.',
        requires: lifestyle('leader', 'Meneur d’hommes'),
        apply: (s, c) => {
          morale(c.player, 3);
          morale(c.player2, 3);
          teamMorale(s, 4);
          return 'Une poignée de main devant tout le groupe.';
        },
      },
      {
        label: 'Laisser couver',
        outcome: 'Moral de l’équipe −3. La situation risque de dégénérer.',
        apply: (s, c) => {
          teamMorale(s, -3);
          chain(s, 'clan-war', 3, { ...c, player: c.player2, player2: c.player });
          return 'Vous espérez que ça passe tout seul.';
        },
      },
    ],
  },
  {
    id: 'clan-war',
    title: 'La guerre des clans',
    followUp: true,
    text: (c) => `${pname(c)} a refusé de faire la passe à ${p2name(c)} pendant le dernier match. Les images tournent en boucle.`,
    options: [
      {
        label: 'Écarter le fauteur de troubles',
        outcome: 'Il devient transférable, moral −10, moral de l’équipe +5.',
        apply: (s, c) => {
          if (c.player) c.player.transferListed = true;
          morale(c.player, -10);
          teamMorale(s, 5);
          return 'Le calme revient dans le vestiaire.';
        },
      },
      {
        label: 'Séminaire de cohésion (150 k€)',
        outcome: 'Moral des deux +6, moral de l’équipe +4.',
        apply: (s, c) => {
          if (!canPay(s, 150_000)) return 'La trésorerie ne le permet pas.';
          pay(s, 150_000, 'Séminaire de cohésion');
          morale(c.player, 6);
          morale(c.player2, 6);
          teamMorale(s, 4);
          return 'Rafting et feux de camp : le groupe se ressoude.';
        },
      },
    ],
  },
  {
    id: 'long-rehab',
    title: 'Le long chemin du retour',
    pickPlayer: (s) => byRating(userSquad(s)).find((p) => p.injuryWeeks >= 5),
    condition: (s) => userSquad(s).some((p) => p.injuryWeeks >= 5),
    text: (c) => `${pname(c)} entame une longue rééducation (${c.player?.injuryWeeks ?? '?'} semaines). Il traverse des moments de doute.`,
    options: [
      {
        label: 'Programme individualisé (180 k€)',
        outcome: 'Indisponibilité −25 %. À son retour, il pourrait revenir plus fort.',
        apply: (s, c) => {
          if (!canPay(s, 180_000)) return 'La trésorerie ne le permet pas.';
          pay(s, 180_000, 'Rééducation individualisée');
          if (c.player) {
            c.player.injuryWeeks = Math.max(1, Math.round(c.player.injuryWeeks * 0.75));
            chain(s, 'comeback', c.player.injuryWeeks, c);
          }
          return 'Kinés, nutritionniste et préparateur mental à son chevet.';
        },
      },
      {
        label: 'Lui rendre visite chaque semaine',
        outcome: 'Moral +12. À son retour, il pourrait revenir plus fort.',
        apply: (s, c) => {
          morale(c.player, 12);
          if (c.player) chain(s, 'comeback', c.player.injuryWeeks, c);
          return 'Il ne se sent pas oublié.';
        },
      },
      {
        label: 'Laisser faire le staff médical',
        outcome: 'Aucun effet.',
        apply: () => 'La rééducation suit son cours.',
      },
    ],
  },
  {
    id: 'comeback',
    title: 'Le retour du guerrier',
    followUp: true,
    text: (c) => `${pname(c)} est de retour à l'entraînement après sa longue blessure. Le groupe l'accueille par une haie d'honneur.`,
    options: [
      {
        label: 'Le relancer tout de suite',
        outcome: 'Statut Titulaire, moral +10, forme +1. Il devient « Décisif ».',
        apply: (_s, c) => {
          if (c.player) {
            c.player.squadStatus = 'regular';
            c.player.form = clamp(c.player.form + 1, 0, 10);
          }
          morale(c.player, 10);
          setTraits(c.player, ['clutch']);
          return 'Il a faim de ballon.';
        },
      },
      {
        label: 'Retour progressif',
        outcome: 'Moral +5, fatigue remise à zéro, risque de blessure −5 % pendant 3 semaines.',
        apply: (s, c, _r, ids) => {
          morale(c.player, 5);
          if (c.player) c.player.fatigue = 0;
          modifier(s, ids, 'Reprise en douceur', { injuryRisk: -0.05 }, 3);
          return 'Quelques minutes par match, pas plus.';
        },
      },
    ],
  },
  {
    id: 'contract-year',
    title: 'Il joue son contrat',
    pickPlayer: (s) => byRating(userSquad(s)).slice(0, 14).find((p) => p.contractYears <= 1 && p.age < 31),
    condition: (s) => s.currentWeek >= 3 && byRating(userSquad(s)).slice(0, 14).some((p) => p.contractYears <= 1 && p.age < 31),
    text: (c) => `En fin de contrat, ${pname(c)} se défonce à chaque match. Tout le monde sait pourquoi : il prépare la négociation.`,
    options: [
      {
        label: 'Le laisser se montrer',
        outcome: 'Forme +2. Dans six semaines, son agent viendra avec des exigences.',
        apply: (s, c) => {
          if (c.player) c.player.form = clamp(c.player.form + 2, 0, 10);
          chain(s, 'contract-showdown', 6, c);
          return 'Il joue les meilleurs matchs de sa carrière.';
        },
      },
      {
        label: 'Prolonger maintenant (+2 ans, +15 %)',
        outcome: 'Contrat +2 ans, salaire +15 %, moral +8.',
        apply: (_s, c) => {
          if (c.player) {
            c.player.contractYears += 2;
            c.player.wage = Math.round(c.player.wage * 1.15);
          }
          morale(c.player, 8);
          return 'Affaire conclue avant que sa cote ne s’envole.';
        },
      },
    ],
  },
  {
    id: 'contract-showdown',
    title: 'L’heure de la négociation',
    followUp: true,
    text: (c) => `L'agent de ${pname(c)} pose ses conditions : un salaire doublé, sinon son client partira libre en fin de saison.`,
    options: [
      {
        label: 'Accepter (salaire ×2, +3 ans)',
        outcome: 'Contrat +3 ans, salaire doublé, moral +15.',
        apply: (_s, c) => {
          if (c.player) {
            c.player.contractYears += 3;
            c.player.wage = c.player.wage * 2;
          }
          morale(c.player, 15);
          return 'Il signe le contrat de sa vie.';
        },
      },
      {
        label: 'Le vendre tant qu’il a de la valeur',
        outcome: 'Joueur transférable, prix de vente +10 % pendant 4 semaines.',
        apply: (s, c, _r, ids) => {
          if (c.player) c.player.transferListed = true;
          modifier(s, ids, 'Vente d’opportunité', { salePrice: 0.1 }, 4);
          return 'Les offres affluent pour ce joueur en pleine forme.';
        },
      },
      {
        label: 'Contre-proposition (+40 %)',
        outcome: 'Une chance sur deux qu’il accepte (+2 ans, +40 %) ; sinon moral −15 et discussions bloquées.',
        apply: (s, c, rng) => {
          if (!c.player) return '';
          if (rng.chance(hasTrait(c.player, 'loyal') ? 0.85 : 0.5)) {
            c.player.contractYears += 2;
            c.player.wage = Math.round(c.player.wage * 1.4);
            morale(c.player, 8);
            return 'Après une nuit de discussions, accord trouvé.';
          }
          morale(c.player, -15);
          c.player.talksBlockedUntil = s.season * 100 + s.currentWeek + 6;
          return 'L’agent claque la porte.';
        },
      },
    ],
  },
  {
    id: 'retirement',
    title: 'La dernière saison',
    pickPlayer: (s) => [...userSquad(s)].filter((p) => p.age >= 33).sort((a, b) => b.age - a.age)[0],
    condition: (s) => userSquad(s).some((p) => p.age >= 33),
    text: (c) => `${pname(c)}, ${c.player?.age ?? '?'} ans, vous confie qu'il raccrochera les crampons à la fin de la saison. Il aimerait rester dans le football.`,
    options: [
      {
        label: 'Lui proposer de rejoindre le staff',
        outcome: 'Il quitte l’effectif et devient entraîneur adjoint : ses traits de joueur deviennent des traits de personnage (Meneur → Charismatique, Professionnel → Méticuleux…).',
        apply: (s, c, rng, ids) => {
          if (!c.player) return '';
          const m = playerToStaff(s, c.player, 'assistant', rng, ids);
          addNews(s, 'staff', `${m.firstName} ${m.lastName} rejoint le staff`, 'Il devient entraîneur adjoint après sa carrière de joueur.', ids);
          leaveClub(s, c.player);
          return 'Il échange ses crampons contre un sifflet.';
        },
      },
      {
        label: 'En faire le futur formateur',
        outcome: 'Il quitte l’effectif et prend la direction du centre de formation.',
        apply: (s, c, rng, ids) => {
          if (!c.player) return '';
          const m = playerToStaff(s, c.player, 'youth', rng, ids);
          addNews(s, 'staff', `${m.firstName} ${m.lastName} prend en charge les jeunes`, 'Une transmission au cœur du club.', ids);
          leaveClub(s, c.player);
          return 'Les jeunes ont désormais un modèle.';
        },
      },
      {
        label: 'Tournée d’adieu jusqu’à la fin de saison',
        outcome: 'Il reste joueur. Recettes +4 % et moral +0,3 par semaine pendant 10 semaines.',
        apply: (s, _c, _r, ids) => {
          modifier(s, ids, 'Tournée d’adieu', { income: 0.04, morale: 0.3 }, 10);
          return 'Chaque stade lui réserve une ovation.';
        },
      },
    ],
  },
  {
    id: 'hidden-pain',
    title: 'Douleur cachée',
    role: 'doctor',
    pickPlayer: (s) => byRating(userSquad(s)).slice(0, 11).find((p) => p.fatigue >= 35 && p.injuryWeeks === 0) ?? byRating(userSquad(s))[0],
    condition: (s) => userSquad(s).some((p) => p.fatigue >= 35 && p.injuryWeeks === 0),
    text: (c) => `${name(c.staff)} a remarqué que ${pname(c)} grimace à chaque sprint. Le joueur nie tout : il ne veut pas perdre sa place.`,
    options: [
      {
        label: 'Le mettre au repos deux semaines',
        outcome: 'Indisponible 2 semaines, fatigue remise à zéro, moral −5.',
        apply: (_s, c) => {
          if (c.player) {
            c.player.injuryWeeks = Math.max(c.player.injuryWeeks, 2);
            c.player.injury = 'Repos préventif';
            c.player.fatigue = 0;
          }
          morale(c.player, -5);
          return 'Mieux vaut deux semaines que deux mois.';
        },
      },
      {
        label: 'Le laisser jouer',
        outcome: 'Moral +4… mais la douleur pourrait s’aggraver.',
        apply: (s, c, rng) => {
          morale(c.player, 4);
          if (rng.chance(hasTrait(c.player, 'professional') ? 0.35 : 0.6)) chain(s, 'injury-worsens', 3, c);
          return 'Il serre les dents.';
        },
      },
    ],
  },
  {
    id: 'injury-worsens',
    title: 'Ce qui devait arriver',
    followUp: true,
    text: (c) => `${pname(c)} s'est effondré à l'entraînement. Le petit pépin ignoré est devenu une vraie blessure.`,
    options: [
      {
        label: 'Assumer votre erreur',
        outcome: 'Indisponible 6 semaines. Opinion du médecin +5, moral de l’équipe +1.',
        apply: (s, c) => {
          if (c.player) {
            c.player.injuryWeeks = Math.max(c.player.injuryWeeks, 6);
            c.player.injury = 'Déchirure musculaire';
          }
          opinion(s.staff.find((m) => m.role === 'doctor'), 5);
          teamMorale(s, 1);
          return 'Une leçon retenue par tout le staff.';
        },
      },
      {
        label: 'Accuser le préparateur physique',
        outcome: 'Indisponible 6 semaines. Opinion du préparateur −12.',
        apply: (s, c) => {
          if (c.player) {
            c.player.injuryWeeks = Math.max(c.player.injuryWeeks, 6);
            c.player.injury = 'Déchirure musculaire';
          }
          opinion(s.staff.find((m) => m.role === 'fitness'), -12);
          return 'L’ambiance se tend dans le staff.';
        },
      },
    ],
  },
  {
    id: 'racist-chants',
    title: 'Insultes en tribune',
    pickPlayer: (s) => byRating(userSquad(s)).find((p) => isNonEu(p)) ?? byRating(userSquad(s))[0],
    condition: (s) => userSquad(s).some((p) => isNonEu(p)),
    text: (c) => `${pname(c)} a été visé par des insultes venues de la tribune adverse lors du dernier déplacement. Il est profondément touché.`,
    options: [
      {
        label: 'Le soutenir publiquement et saisir la ligue',
        outcome: 'Moral du joueur +12, moral de l’équipe +4, confiance de la direction +2.',
        apply: (s, c) => {
          morale(c.player, 12);
          teamMorale(s, 4);
          board(s, 2);
          return 'Tout le club fait bloc derrière lui.';
        },
      },
      {
        label: 'En parler en privé avec lui',
        outcome: 'Moral du joueur +6.',
        apply: (_s, c) => {
          morale(c.player, 6);
          return 'Il apprécie votre écoute.';
        },
      },
    ],
  },
  {
    id: 'foundation',
    title: 'La fondation du joueur',
    pickPlayer: (s) => byRating(userSquad(s)).find((p) => hasTrait(p, 'professional') || hasTrait(p, 'leader') || hasTrait(p, 'loyal')),
    condition: (s) => userSquad(s).some((p) => hasTrait(p, 'professional') || hasTrait(p, 'leader') || hasTrait(p, 'loyal')),
    text: (c) => `${pname(c)} lance une fondation pour les enfants de son quartier d'origine et aimerait que le club s'associe au projet.`,
    options: [
      {
        label: 'Associer le club (100 k€)',
        outcome: 'Moral du joueur +10, confiance de la direction +3, recettes +2 % pendant 10 semaines.',
        apply: (s, c, _r, ids) => {
          pay(s, 100_000, 'Partenariat caritatif');
          morale(c.player, 10);
          board(s, 3);
          modifier(s, ids, 'Image du club', { income: 0.02 }, 10);
          return 'Une belle initiative, saluée par la presse.';
        },
      },
      {
        label: 'Le soutenir à titre personnel',
        outcome: 'Moral du joueur +5.',
        apply: (_s, c) => {
          morale(c.player, 5);
          return 'Vous faites un don discret.';
        },
      },
    ],
  },
  {
    id: 'release-clause-paid',
    title: 'La clause est payée',
    pickPlayer: (s) => byRating(userSquad(s)).find((p) => p.releaseClause !== null),
    pickClub: (s) => [...s.clubs].filter((c) => c.id !== s.userClubId).sort((a, b) => b.reputation - a.reputation)[1],
    condition: (s) => userSquad(s).some((p) => p.releaseClause !== null),
    text: (c) => `${c.club?.name ?? 'Un club'} vient de déposer le montant de la clause libératoire de ${pname(c)} (${c.player?.releaseClause ? millions(c.player.releaseClause) : '?'}). Le joueur doit maintenant donner son accord.`,
    options: [
      {
        label: 'Le laisser décider',
        outcome: 'Il part si son moral est inférieur à 70 (vous touchez la clause) ; sinon il reste, moral +5.',
        apply: (s, c, _r, ids) => {
          if (!c.player || !c.club) return '';
          if (c.player.morale < 70) {
            addMoney(s, s.userClubId, 'transferOut', c.player.releaseClause ?? 0, `Clause de ${fullName(c.player)}`);
            const club = clubById(s, s.userClubId);
            club.tactic.lineup = club.tactic.lineup.map((id) => (id === c.player!.id ? null : id));
            c.player.clubId = c.club.id;
            c.player.releaseClause = null;
            addNews(s, 'transfer', `${fullName(c.player)} lève sa clause`, `Il rejoint ${c.club.name}.`, ids);
            return 'Il fait ses valises.';
          }
          morale(c.player, 5);
          return 'Il est heureux ici : il dit non.';
        },
      },
      {
        label: 'Le convaincre de rester',
        outcome: 'Il reste, salaire +25 %, clause supprimée.',
        apply: (_s, c) => {
          if (c.player) {
            c.player.wage = Math.round(c.player.wage * 1.25);
            c.player.releaseClause = null;
          }
          return 'Un nouveau contrat, sans clause cette fois.';
        },
      },
      {
        label: 'Il reste par fidélité',
        outcome: 'Il reste sans augmentation, clause supprimée, moral de l’équipe +3.',
        requires: playerTrait('loyal'),
        apply: (s, c) => {
          if (c.player) c.player.releaseClause = null;
          teamMorale(s, 3);
          return '« Je ne partirai jamais pour de l’argent. »';
        },
      },
    ],
  },

  // ---------------------------------------------------------------- 5e vague : vie du club
  {
    id: 'womens-team',
    title: 'Une section féminine',
    text: (_c, s) => `La direction envisage de créer une équipe féminine professionnelle sous les couleurs de ${clubById(s, s.userClubId).name}.`,
    options: [
      {
        label: 'Lancer le projet (500 k€)',
        outcome: 'Confiance de la direction +5, moral de l’équipe +2, recettes +3 % pendant 20 semaines.',
        apply: (s, _c, _r, ids) => {
          if (!canPay(s, 500_000)) return 'La trésorerie ne le permet pas.';
          pay(s, 500_000, 'Création de la section féminine');
          board(s, 5);
          teamMorale(s, 2);
          modifier(s, ids, 'Section féminine', { income: 0.03 }, 20);
          return 'Une nouvelle page de l’histoire du club s’ouvre.';
        },
      },
      {
        label: 'Reporter',
        outcome: 'Confiance de la direction −2.',
        apply: (s) => {
          board(s, -2);
          return 'Le projet attendra.';
        },
      },
    ],
  },
  {
    id: 'anniversary',
    title: 'L’anniversaire du club',
    condition: (s) => s.currentWeek >= 10 && s.currentWeek <= 20,
    text: (_c, s) => `${clubById(s, s.userClubId).name} fête un anniversaire symbolique. Les supporters attendent un geste fort.`,
    options: [
      {
        label: 'Match de gala contre les légendes',
        outcome: '+400 k€, moral de l’équipe +5, fatigue +5 pour l’effectif.',
        apply: (s) => {
          addMoney(s, s.userClubId, 'gate', 400_000, 'Match de gala');
          teamMorale(s, 5);
          userSquad(s).forEach((p) => (p.fatigue = clamp(p.fatigue + 5, 0, 100)));
          return 'Les anciens ont encore de beaux restes.';
        },
      },
      {
        label: 'Maillot collector',
        outcome: 'Recettes +6 % pendant 6 semaines.',
        apply: (s, _c, _r, ids) => {
          modifier(s, ids, 'Maillot anniversaire', { income: 0.06 }, 6);
          return 'Épuisé en une matinée.';
        },
      },
    ],
  },
  {
    id: 'concert',
    title: 'Un concert au stade',
    text: (_c, s) => `Une star de la musique veut louer le ${clubById(s, s.userClubId).stadium} pour deux soirs.`,
    options: [
      {
        label: 'Louer le stade (+1,2 M€)',
        outcome: '+1,2 M€, risque de blessure +8 % pendant 3 semaines (pelouse abîmée).',
        apply: (s, _c, _r, ids) => {
          addMoney(s, s.userClubId, 'gate', 1_200_000, 'Location du stade');
          modifier(s, ids, 'Pelouse piétinée', { injuryRisk: 0.08 }, 3);
          return 'Deux soirs de folie… et une pelouse à refaire.';
        },
      },
      {
        label: 'Refuser',
        outcome: 'Opinion du préparateur physique +4.',
        apply: (s) => {
          opinion(s.staff.find((m) => m.role === 'fitness'), 4);
          return 'La pelouse est sacrée.';
        },
      },
    ],
  },
  {
    id: 'foreign-academy',
    title: 'Partenariat avec une académie étrangère',
    role: 'youth',
    text: (c) => `Une académie réputée d'Afrique de l'Ouest propose un partenariat. ${name(c.staff)} y voit une mine de talents.`,
    options: [
      {
        label: 'Signer le partenariat (350 k€)',
        outcome: 'Potentiel des promotions +3 et fiabilité des rapports +5 pendant 30 semaines.',
        apply: (s, c, _r, ids) => {
          if (!canPay(s, 350_000)) return 'La trésorerie ne le permet pas.';
          pay(s, 350_000, 'Partenariat avec une académie');
          modifier(s, ids, 'Académie partenaire', { youthPotential: 3, scoutAccuracy: 5 }, 30);
          opinion(c.staff, 6);
          return 'Les premiers jeunes arriveront avec la prochaine promotion.';
        },
      },
      {
        label: 'Décliner',
        outcome: 'Opinion −4.',
        apply: (_s, c) => {
          opinion(c.staff, -4);
          return 'Le formateur range le dossier.';
        },
      },
    ],
  },
  {
    id: 'journalist-feud',
    title: 'Le journaliste qui vous déteste',
    text: () => 'Un éditorialiste vedette vous attaque chaque semaine : « dépassé », « sans idées ». Ses chroniques font réagir la direction.',
    options: [
      {
        label: 'Lui accorder une interview exclusive',
        outcome: 'Confiance de la direction +4.',
        apply: (s) => {
          board(s, 4);
          return 'Il découvre votre projet… et adoucit le ton.';
        },
      },
      {
        label: 'Le boycotter',
        outcome: 'Moral de l’équipe +2, confiance de la direction −3.',
        apply: (s) => {
          teamMorale(s, 2);
          board(s, -3);
          return 'Il n’est plus accrédité au centre d’entraînement.';
        },
      },
      {
        label: 'Lui répondre sur le terrain',
        outcome: 'Force en match +2 % pendant 2 semaines.',
        requires: lifestyle('tactician', 'Tacticien'),
        apply: (s, _c, _r, ids) => {
          modifier(s, ids, 'Revanche tactique', { matchStrength: 0.02 }, 2);
          return 'Vous préparez un plan qui le fera taire.';
        },
      },
    ],
  },
  {
    id: 'presidential-election',
    title: 'Élection à la présidence',
    condition: (s) => s.currentWeek >= 12,
    text: () => 'Le club élit son président. Deux candidats sollicitent votre soutien : un ambitieux prêt à dépenser, un gestionnaire rigoureux.',
    options: [
      {
        label: 'Soutenir l’ambitieux',
        outcome: 'Budget transferts +4 M€, entretien +10 % pendant 20 semaines.',
        apply: (s, _c, _r, ids) => {
          clubById(s, s.userClubId).transferBudget += 4_000_000;
          modifier(s, ids, 'Présidence dépensière', { upkeep: 0.1 }, 20);
          return 'Il est élu et ouvre le chéquier.';
        },
      },
      {
        label: 'Soutenir le gestionnaire',
        outcome: 'Entretien −15 % et recettes +3 % pendant 20 semaines, budget transferts −1 M€.',
        apply: (s, _c, _r, ids) => {
          const club = clubById(s, s.userClubId);
          club.transferBudget = Math.max(0, club.transferBudget - 1_000_000);
          modifier(s, ids, 'Gestion rigoureuse', { upkeep: -0.15, income: 0.03 }, 20);
          return 'Les comptes seront tenus au centime près.';
        },
      },
      {
        label: 'Rester neutre',
        outcome: 'Confiance de la direction +2.',
        apply: (s) => {
          board(s, 2);
          return 'Vous travaillerez avec le vainqueur.';
        },
      },
    ],
  },
  {
    id: 'deadline-day',
    title: 'Dernier jour du mercato',
    condition: (s) => s.currentWeek === 3 || s.currentWeek === 19,
    text: () => 'Le téléphone n’arrête pas de sonner : dernier jour du mercato. Un agent propose un joueur libre de dernière minute.',
    options: [
      {
        label: 'Tenter le coup',
        outcome: 'Un joueur libre, bien connu de vos recruteurs, apparaît dans Transferts.',
        apply: (s, _c, rng, ids) => {
          const level = clubById(s, s.userClubId).level;
          const p = createPlayer(rng, { id: ids('p'), position: rng.pick(SQUAD_TEMPLATE), meanRating: 66 + level * 2, clubId: null, age: rng.int(23, 30) });
          p.contractYears = 0;
          p.scoutedBy = 'Appel de dernière minute';
          s.players.push(p);
          s.scouting.knowledge[p.id] = 85;
          return `${fullName(p)} (${POSITION_LABELS[p.position]}) attend votre offre.`;
        },
      },
      {
        label: 'L’effectif est complet',
        outcome: 'Aucun effet.',
        apply: () => 'Vous éteignez votre téléphone.',
      },
    ],
  },
];

const DEFS = new Map(EVENTS.map((e) => [e.id, e]));
export const eventDef = (id: string) => DEFS.get(id);

export function eventContext(s: GameState, e: { staffId?: string; staff2Id?: string; playerId?: string; player2Id?: string; clubId?: string }): EventContext {
  return {
    staff: e.staffId ? s.staff.find((m) => m.id === e.staffId) : undefined,
    staff2: e.staff2Id ? s.staff.find((m) => m.id === e.staff2Id) : undefined,
    player: e.playerId ? s.players.find((p) => p.id === e.playerId) : undefined,
    player2: e.player2Id ? s.players.find((p) => p.id === e.player2Id) : undefined,
    club: e.clubId ? s.clubs.find((c) => c.id === e.clubId) : undefined,
  };
}

/**
 * Chaque semaine, une chance qu'un événement survienne (un seul à la fois).
 * Les événements « urgents » naissent de la situation (série de défaites, cadre mécontent,
 * trésorerie dans le rouge…) et passent en priorité, comme les crises de Crusader Kings.
 */
export function maybeTriggerEvent(s: GameState, rng: Rng, ids: IdGen): void {
  if (s.events.length || s.manager.unemployed) return;
  // Les suites programmées passent avant tout (si leurs protagonistes sont toujours là).
  const queue = s.eventQueue ?? [];
  const due = queue.find((q) => q.due <= stamp(s));
  if (due) {
    s.eventQueue = queue.filter((q) => q !== due);
    const def = eventDef(due.defId);
    const ctx = eventContext(s, due);
    const valid = !!def && (!due.playerId || ownPlayer(s, ctx.player)) && (!due.staffId || !!ctx.staff) && (!def.condition || def.condition(s));
    if (def && valid) {
      s.events.push({ id: ids('e'), defId: def.id, staffId: due.staffId, playerId: due.playerId, player2Id: due.player2Id, clubId: due.clubId, season: s.season, week: s.currentWeek });
      return;
    }
  }
  const recent = new Set(s.news.slice(0, 40).filter((n) => n.kind === 'event').map((n) => n.title));
  const available = EVENTS.filter((e) => {
    if (e.followUp || recent.has(e.title)) return false;
    if (e.condition && !e.condition(s)) return false;
    if (e.role && !s.staff.some((m) => m.role === e.role)) return false;
    return true;
  });
  const urgent = available.filter((e) => e.urgent);
  let def: EventDef | undefined;
  if (urgent.length && rng.chance(0.65)) def = rng.pick(urgent);
  else if (available.length && rng.chance(0.22)) def = rng.pick(available);
  if (!def) return;
  const staff = def.pickStaff?.(s) ?? (def.role ? rng.pick(s.staff.filter((m) => m.role === def!.role)) : undefined);
  const staff2 = def.pickStaff2?.(s, staff);
  if (def.pickStaff2 && (!staff || !staff2)) return;
  const player = def.pickPlayer?.(s);
  if (def.pickPlayer && !player) return;
  const player2 = def.pickPlayer2?.(s, player);
  if (def.pickPlayer2 && !player2) return;
  const club = def.pickClub?.(s);
  s.events.push({ id: ids('e'), defId: def.id, staffId: staff?.id, staff2Id: staff2?.id, playerId: player?.id, player2Id: player2?.id, clubId: club?.id, season: s.season, week: s.currentWeek });
}

export function resolveEvent(s: GameState, eventId: string, option: number, rng: Rng, ids: IdGen): string {
  const e = s.events.find((x) => x.id === eventId);
  const def = e ? eventDef(e.defId) : undefined;
  if (!e || !def || !def.options[option]) return '';
  const ctx = eventContext(s, e);
  if (!optionAvailable(s, ctx, def.options[option])) return '';
  const result = def.options[option].apply(s, ctx, rng, ids);
  s.events = s.events.filter((x) => x.id !== eventId);
  addNews(s, 'event', def.title, `${def.options[option].label}. ${result}`, ids);
  return result;
}

/** Les effets temporaires s'épuisent semaine après semaine. */
export function tickModifiers(s: GameState): void {
  s.modifiers.forEach((m) => m.weeksLeft--);
  s.modifiers = s.modifiers.filter((m) => m.weeksLeft > 0);
}

