import { GameState } from '../models';
import { createBoard } from './board';
import { autoPickLineup, repairLineup } from './lineup';
import { clamp } from './player-factory';
import { Rng } from './rng';
import { addNews, clubById, IdGen, nowStamp, squadOf } from './world';
import { initialStaff } from './characters';
import { Rng as RngClass } from './rng';

export const initialManagerReputation = (clubReputation: number) => Math.round(clubReputation * 0.55 + 12);

/** Crée jusqu'à `count` offres d'emploi parmi les clubs dont la réputation est dans l'intervalle. */
export function generateJobOffers(s: GameState, rng: Rng, ids: IdGen, minRep: number, maxRep: number, count: number, chance = 1): number {
  const taken = new Set(s.jobOffers.filter((o) => o.status === 'pending').map((o) => o.clubId));
  const candidates = rng.shuffle(s.clubs.filter((c) => c.id !== s.userClubId && !taken.has(c.id) && c.reputation >= minRep && c.reputation <= maxRep));
  let made = 0;
  for (const club of candidates) {
    if (made >= count) break;
    if (!rng.chance(chance)) continue;
    s.jobOffers.push({ id: ids('j'), clubId: club.id, expires: nowStamp(s) + 3, status: 'pending' });
    addNews(s, 'career', `${club.name} veut vous recruter`, `${club.name} (réputation ${club.reputation}) vous propose de prendre la direction de son équipe. Répondez depuis l'onglet Carrière du club.`, ids);
    made++;
  }
  return made;
}

/** Limogeage : l'entraîneur se retrouve sans club et reçoit des propositions de clubs plus modestes. */
export function sackManager(s: GameState, rng: Rng, ids: IdGen): void {
  const m = s.manager;
  closeCareerEntry(s, 'sacked');
  m.unemployed = true;
  m.reputation = clamp(m.reputation - 6, 5, 100);
  const club = clubById(s, s.userClubId);
  addNews(s, 'career', `Limogé par ${club.name}`, `La direction a perdu confiance et met fin à votre contrat. D'autres clubs se renseignent déjà sur vous.`, ids);
  const made = generateJobOffers(s, rng, ids, 0, m.reputation + 8, 3);
  if (made === 0) {
    // Toujours au moins une porte de sortie : les clubs les plus modestes.
    const modest = [...s.clubs].filter((c) => c.id !== s.userClubId).sort((a, b) => a.reputation - b.reputation).slice(0, 2);
    modest.forEach((c) => s.jobOffers.push({ id: ids('j'), clubId: c.id, expires: nowStamp(s) + 99, status: 'pending' }));
  } else {
    // Sans emploi, les offres ne doivent pas expirer avant d'avoir été vues.
    s.jobOffers.forEach((o) => o.status === 'pending' && (o.expires = nowStamp(s) + 99));
  }
}

function closeCareerEntry(s: GameState, exit: 'sacked' | 'left'): void {
  const current = s.manager.career[s.manager.career.length - 1];
  if (current && current.toSeason === undefined) {
    current.toSeason = s.season;
    current.toWeek = s.currentWeek;
    current.exit = exit;
  }
}

export function acceptJob(s: GameState, offerId: string, ids: IdGen): { ok: boolean; message: string } {
  const offer = s.jobOffers.find((o) => o.id === offerId && o.status === 'pending');
  if (!offer) return { ok: false, message: 'Cette offre n\'est plus valable.' };
  const previous = clubById(s, s.userClubId);
  const next = clubById(s, offer.clubId);
  if (!s.manager.unemployed) {
    closeCareerEntry(s, 'left');
    previous.tactic.slots = undefined;
    previous.tactic.lineup = autoPickLineup(squadOf(s, previous.id), previous.tactic.formation);
  }
  s.jobOffers.forEach((o) => o.status === 'pending' && (o.status = o.id === offerId ? 'accepted' : 'expired'));
  s.userClubId = next.id;
  s.manager.unemployed = false;
  s.manager.career.push({ clubId: next.id, fromSeason: s.season, fromWeek: s.currentWeek });
  s.offers = [];
  s.feeAgreements = [];
  s.negotiations = {};
  s.board = createBoard(s, 60);
  // Nouveau club, nouveau staff : celui de l'ancien club reste en place.
  s.staff = initialStaff(s, rngFor(s), ids);
  s.missions = [];
  s.events = [];
  next.tactic.lineup = repairLineup(next.tactic, squadOf(s, next.id));
  addNews(s, 'career', `Nouveau défi : ${next.name}`, `Vous êtes le nouvel entraîneur de ${next.name}. Découvrez votre effectif et les objectifs de la direction.`, ids);
  return { ok: true, message: `Bienvenue à ${next.name} !` };
}

export function declineJob(s: GameState, offerId: string): void {
  const offer = s.jobOffers.find((o) => o.id === offerId);
  if (offer && offer.status === 'pending' && !s.manager.unemployed) offer.status = 'rejected';
}

/** Réputation de fin de saison, trophées et offres des clubs intéressés. */
export function seasonEndCareer(s: GameState, position: number, target: number, champion: boolean, cupWinner: boolean, rng: Rng, ids: IdGen): void {
  const m = s.manager;
  const club = clubById(s, s.userClubId);
  m.reputation = clamp(Math.round(m.reputation + clamp((target - position) * 1.5, -8, 8) + (champion ? 8 : 0) + (cupWinner ? 5 : 0)), 5, 100);
  if (champion) m.trophies.push({ season: s.season, title: 'Champion de Division Élite', clubId: club.id });
  if (cupWinner) m.trophies.push({ season: s.season, title: 'Vainqueur de la Coupe Nationale', clubId: club.id });
  if (!m.unemployed) generateJobOffers(s, rng, ids, m.reputation - 5, m.reputation + 12, 2, 0.35);
}

/** Toutes les 8 semaines, un entraîneur dont la cote dépasse son club peut être approché. */
export function midSeasonInterest(s: GameState, rng: Rng, ids: IdGen): void {
  const club = clubById(s, s.userClubId);
  if (s.manager.unemployed || s.manager.reputation < club.reputation + 8 || !rng.chance(0.3)) return;
  generateJobOffers(s, rng, ids, club.reputation + 5, s.manager.reputation + 10, 1);
}

export function expireJobOffers(s: GameState): void {
  s.jobOffers.forEach((o) => o.status === 'pending' && o.expires < nowStamp(s) && (o.status = 'expired'));
}

/** Aléa dérivé de la graine (l'acceptation d'un poste n'a pas de générateur dédié). */
function rngFor(s: GameState): RngClass {
  return new RngClass((s.rngSeed ^ 0x9e3779b9 ^ s.nextId) >>> 0);
}

export interface ClubIdentity {
  name: string;
  shortName: string;
  stadium: string;
  primary: string;
  secondary: string;
}

/** Renomme le club de l'entraîneur (nom, sigle, stade, couleurs). */
export function renameClub(s: GameState, data: ClubIdentity, ids: IdGen): { ok: boolean; message: string } {
  const club = clubById(s, s.userClubId);
  const name = data.name.trim().replace(/\s+/g, ' ');
  const shortName = data.shortName.trim().toUpperCase();
  const stadium = data.stadium.trim().replace(/\s+/g, ' ');
  if (name.length < 3 || name.length > 32) return { ok: false, message: 'Le nom doit compter entre 3 et 32 caractères.' };
  if (!/^[A-Z0-9ÀÂÉÈÊËÎÏÔÙÛÜÇ]{2,4}$/.test(shortName)) return { ok: false, message: 'Le sigle doit compter 2 à 4 lettres ou chiffres.' };
  if (stadium.length < 3 || stadium.length > 40) return { ok: false, message: 'Le nom du stade doit compter entre 3 et 40 caractères.' };
  const color = /^#[0-9a-f]{6}$/i;
  if (!color.test(data.primary) || !color.test(data.secondary)) return { ok: false, message: 'Couleurs invalides.' };
  const others = s.clubs.filter((c) => c.id !== club.id);
  if (others.some((c) => c.name.toLowerCase() === name.toLowerCase())) return { ok: false, message: 'Un autre club porte déjà ce nom.' };
  if (others.some((c) => c.shortName === shortName)) return { ok: false, message: 'Ce sigle est déjà utilisé par un autre club.' };
  const old = club.name;
  club.name = name;
  club.shortName = shortName;
  club.stadium = stadium;
  club.colors = { ...club.colors, primary: data.primary, secondary: data.secondary };
  if (old !== name) addNews(s, 'season', `${old} devient ${name}`, `Le club adopte un nouveau nom, un nouveau sigle (${shortName}) et joue désormais au ${stadium}.`, ids);
  return { ok: true, message: 'Nouvelle identité enregistrée.' };
}
