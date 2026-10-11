import { ContractOffer, GameState, Player, SQUAD_STATUS_LABELS, SQUAD_STATUS_ORDER, SquadStatus } from '../models';
import { wageBill } from './finance';
import { statusForRank } from './player-factory';
import { executeTransfer, formatK, formatM, MAX_SQUAD, requiredReputation } from './transfers';
import { expectedWage, marketValue, roundMoney } from './valuation';
import { addMoney, addNews, clubById, fullName, IdGen, nowStamp, playerById, squadOf } from './world';
import { fx } from './characters';

export type NegotiationContext = 'renewal' | 'transfer' | 'free';

export interface ContractDemands {
  wage: number;
  years: number;
  status: SquadStatus;
  wantsClause: boolean;
  /** Clause libératoire maximale acceptée par le joueur (s'il en veut une). */
  maxClause: number;
}

export interface NegotiationResult {
  outcome: 'accepted' | 'counter' | 'rejected' | 'walkout' | 'invalid';
  message: string;
  /** Satisfaction du joueur (1 = offre acceptable). */
  satisfaction?: number;
  roundsLeft?: number;
  counter?: ContractOffer;
}

export const MAX_ROUNDS = 3;
/** Tentatives autorisées, avantages compris. */
export const maxRounds = (s: GameState) => MAX_ROUNDS + Math.round(fx(s, 'negotiationRounds'));
const STATUS_WAGE: Record<SquadStatus, number> = { key: 1.15, regular: 1.05, rotation: 0.95, backup: 0.85, prospect: 0.8 };

export function negotiationContext(s: GameState, p: Player): NegotiationContext {
  if (p.clubId === s.userClubId) return 'renewal';
  return p.clubId ? 'transfer' : 'free';
}

/** Statut que le joueur estime mériter dans l'effectif de l'utilisateur. */
export function deservedStatus(s: GameState, p: Player): SquadStatus {
  const squad = squadOf(s, s.userClubId).filter((x) => x.id !== p.id);
  const rank = squad.filter((x) => x.rating > p.rating).length;
  return statusForRank(rank, p.age);
}

export function demandsFor(s: GameState, p: Player): ContractDemands {
  const club = clubById(s, s.userClubId);
  const context = negotiationContext(s, p);
  const status = deservedStatus(s, p);
  let wage = Math.max(expectedWage(p), p.wage * (context === 'renewal' ? 1.08 : 1.15));
  if (club.reputation < requiredReputation(p) + 10) wage *= 1.12;
  if (p.morale < 35 && context === 'renewal') wage *= 1.15;
  wage *= STATUS_WAGE[status];
  // Directeur sportif, traits et avantages : les agents sont plus conciliants.
  wage *= Math.max(0.6, 1 + fx(s, 'wageDemands'));
  const years = p.age <= 27 ? 4 : p.age <= 30 ? 3 : p.age <= 32 ? 2 : 1;
  return {
    wage: roundMoney(wage),
    years,
    status,
    wantsClause: p.rating >= 74 || p.potential - p.rating >= 10,
    maxClause: roundMoney(marketValue(p) * 2.5),
  };
}

/** Offre de départ proposée par l'interface : les attentes du joueur, sans prime. */
export function defaultOffer(d: ContractDemands): ContractOffer {
  return { wage: d.wage, years: d.years, signingBonus: 0, releaseClause: d.wantsClause ? d.maxClause : null, status: d.status };
}

export function satisfaction(p: Player, offer: ContractOffer, d: ContractDemands): number {
  const bonusPerWeek = offer.signingBonus / (52 * Math.max(1, offer.years));
  let sat = (offer.wage + bonusPerWeek * 1.5) / d.wage;
  const statusGap = SQUAD_STATUS_ORDER.indexOf(offer.status) - SQUAD_STATUS_ORDER.indexOf(d.status);
  sat -= Math.max(0, statusGap) * 0.08;
  sat += Math.max(0, -statusGap) * 0.03;
  if (offer.years < d.years) sat -= (d.years - offer.years) * 0.05;
  if (offer.years > d.years) sat -= (offer.years - d.years) * 0.02;
  if (d.wantsClause) {
    if (offer.releaseClause === null || offer.releaseClause > d.maxClause) sat -= 0.1;
    else if (offer.releaseClause <= marketValue(p) * 1.5) sat += 0.04;
  }
  return sat;
}

/** Un tour de négociation. En cas d'accord, le contrat est signé immédiatement. */
export function negotiate(s: GameState, playerId: string, offer: ContractOffer, ids: IdGen): NegotiationResult {
  const p = playerById(s, playerId);
  if (!p) return { outcome: 'invalid', message: 'Joueur introuvable.' };
  const club = clubById(s, s.userClubId);
  const context = negotiationContext(s, p);
  if (p.talksBlockedUntil > nowStamp(s)) return { outcome: 'invalid', message: `${fullName(p)} refuse de reprendre les discussions pour le moment.` };

  // Validations de l'offre.
  if (offer.years < 1 || offer.years > 5) return { outcome: 'invalid', message: 'La durée doit être comprise entre 1 et 5 ans.' };
  if (p.age >= 33 && offer.years > 2) return { outcome: 'invalid', message: `À ${p.age} ans, un contrat de 2 ans maximum est autorisé par la direction.` };
  if (context !== 'renewal') {
    if (squadOf(s, s.userClubId).length >= MAX_SQUAD) return { outcome: 'invalid', message: `Effectif complet (${MAX_SQUAD} joueurs maximum).` };
    if (club.reputation < requiredReputation(p)) return { outcome: 'invalid', message: `${fullName(p)} ne souhaite pas rejoindre un club de la stature de ${club.name}.` };
  }
  const agreement = s.feeAgreements.find((a) => a.playerId === p.id && a.expires >= nowStamp(s));
  if (context === 'transfer' && !agreement) return { outcome: 'invalid', message: 'Mettez-vous d\'abord d\'accord avec son club sur l\'indemnité.' };
  const fee = agreement?.fee ?? 0;
  const bill = wageBill(squadOf(s, s.userClubId)) - (context === 'renewal' ? p.wage : 0);
  if (bill + offer.wage > club.wageBudget) {
    return { outcome: 'invalid', message: `Masse salariale dépassée : il reste ${formatK(club.wageBudget - bill)} par semaine de marge.` };
  }
  if (fee + offer.signingBonus > club.transferBudget) {
    return { outcome: 'invalid', message: `Budget transferts insuffisant pour l'indemnité et la prime (${formatM(club.transferBudget)} disponibles).` };
  }

  const d = demandsFor(s, p);
  const sat = satisfaction(p, offer, d);
  if (sat >= 1) {
    sign(s, p, offer, context, fee, ids);
    delete s.negotiations[p.id];
    return { outcome: 'accepted', satisfaction: sat, message: `Accord trouvé ! ${fullName(p)} signe pour ${offer.years} an(s) à ${formatK(offer.wage)} par semaine.` };
  }

  const rounds = (s.negotiations[p.id] ?? 0) + 1;
  s.negotiations[p.id] = rounds;
  if (rounds >= maxRounds(s)) {
    delete s.negotiations[p.id];
    p.talksBlockedUntil = nowStamp(s) + 4;
    s.feeAgreements = s.feeAgreements.filter((a) => a.playerId !== p.id);
    if (context === 'renewal') p.morale = Math.max(5, p.morale - 10);
    return { outcome: 'walkout', satisfaction: sat, roundsLeft: 0, message: `${fullName(p)} met fin aux discussions. Il refusera de négocier pendant 4 semaines.` };
  }

  const roundsLeft = maxRounds(s) - rounds;
  if (sat >= 0.82) {
    const bonusPerWeek = offer.signingBonus / (52 * Math.max(1, d.years));
    const counter: ContractOffer = {
      wage: roundMoney(Math.max(d.wage - bonusPerWeek * 1.5, d.wage * 0.85)),
      years: d.years,
      signingBonus: offer.signingBonus,
      releaseClause: d.wantsClause ? Math.min(offer.releaseClause ?? d.maxClause, d.maxClause) : offer.releaseClause,
      status: SQUAD_STATUS_ORDER.indexOf(offer.status) < SQUAD_STATUS_ORDER.indexOf(d.status) ? offer.status : d.status,
    };
    return {
      outcome: 'counter',
      satisfaction: sat,
      roundsLeft,
      counter,
      message: `Son agent fait une contre-proposition : ${formatK(counter.wage)}/sem., ${counter.years} an(s), statut « ${SQUAD_STATUS_LABELS[counter.status]} ».`,
    };
  }
  return { outcome: 'rejected', satisfaction: sat, roundsLeft, message: `Offre jugée très insuffisante. Encore ${roundsLeft} tentative(s) avant la rupture des discussions.` };
}

function sign(s: GameState, p: Player, offer: ContractOffer, context: NegotiationContext, fee: number, ids: IdGen): void {
  if (context !== 'renewal') {
    executeTransfer(s, p, s.userClubId, fee, offer.wage, ids);
    s.feeAgreements = s.feeAgreements.filter((a) => a.playerId !== p.id);
  } else {
    p.wage = offer.wage;
    p.morale = Math.min(100, p.morale + 8);
    addNews(s, 'transfer', `${fullName(p)} prolonge`, `Nouveau contrat de ${offer.years} an(s), ${formatK(offer.wage)} par semaine, statut « ${SQUAD_STATUS_LABELS[offer.status]} ».`, ids);
  }
  p.contractYears = offer.years;
  p.squadStatus = offer.status;
  p.releaseClause = offer.releaseClause;
  p.transferListed = false;
  if (offer.signingBonus > 0) {
    addMoney(s, s.userClubId, 'bonus', -offer.signingBonus, `Prime à la signature : ${fullName(p)}`);
    const club = clubById(s, s.userClubId);
    club.transferBudget = Math.max(0, club.transferBudget - offer.signingBonus);
  }
}
