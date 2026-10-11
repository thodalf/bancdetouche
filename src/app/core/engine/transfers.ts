import { GameState, Player, POSITION_GROUP } from '../models';
import { wageBill } from './finance';
import { autoPickLineup, isAvailable } from './lineup';
import { assignStatuses, clamp } from './player-factory';
import { Rng } from './rng';
import { askingPrice, expectedWage, marketValue, roundMoney } from './valuation';
import { addMoney, addNews, clubById, fullName, IdGen, isKeyPlayer, nowStamp, playerById, squadOf } from './world';
import { fx } from './characters';

export const MIN_SQUAD = 16;
export const MAX_SQUAD = 32;

export interface TransferOutcome {
  ok: boolean;
  message: string;
  /** Prix demandé par le club vendeur lorsqu'une contre-proposition est faite. */
  counter?: number;
  /** 'contract' : l'indemnité est réglée, il reste à négocier le contrat avec le joueur. */
  stage?: 'contract';
}

/** Salaire hebdomadaire réclamé par le joueur pour signer (estimation affichée sur le marché). */
export const wageDemand = (p: Player) => roundMoney(Math.max(p.wage, expectedWage(p)) * 1.1);

/** Réputation minimale d'un club pour que le joueur accepte de le rejoindre. */
export const requiredReputation = (p: Player) => clamp((p.rating - 60) * 2.2, 0, 95);

export function priceFor(s: GameState, p: Player): number {
  return p.clubId ? askingPrice(p, isKeyPlayer(s, p)) : 0;
}

/** Transfert effectif : argent, effectifs, compositions et actualités. */
export function executeTransfer(s: GameState, p: Player, toClubId: string, fee: number, wage: number, ids: IdGen): void {
  const fromId = p.clubId;
  const buyer = clubById(s, toClubId);
  if (fee > 0) {
    addMoney(s, toClubId, 'transferOut', -fee, `Achat de ${fullName(p)}`);
    buyer.transferBudget = Math.max(0, buyer.transferBudget - fee);
  }
  if (fromId) {
    const seller = clubById(s, fromId);
    if (fee > 0) {
      addMoney(s, fromId, 'transferIn', fee, `Vente de ${fullName(p)}`);
      seller.transferBudget += Math.round(fee * (fromId === s.userClubId ? 0.75 : 0.5));
    }
    seller.tactic.lineup = seller.tactic.lineup.map((id) => (id === p.id ? null : id));
    if (fromId !== s.userClubId) seller.tactic.lineup = autoPickLineup(squadOf(s, fromId).filter((x) => x.id !== p.id), seller.tactic.formation);
  }
  p.clubId = toClubId;
  p.youth = false;
  p.wage = wage;
  p.transferListed = false;
  p.recentApps = [];
  p.morale = Math.min(100, p.morale + 8);
  p.contractYears = Math.max(p.contractYears, 3);
  s.offers = s.offers.map((o) => (o.playerId === p.id && o.status === 'pending' ? { ...o, status: 'expired' } : o));
  if (toClubId !== s.userClubId) {
    const squad = squadOf(s, toClubId);
    assignStatuses(squad);
    p.releaseClause = null;
    buyer.tactic.lineup = autoPickLineup(squad, buyer.tactic.formation);
  }
  const feeText = fee > 0 ? `pour ${formatM(fee)}` : 'libre de tout contrat';
  const from = fromId ? clubById(s, fromId).name : 'libre';
  if (toClubId === s.userClubId || fromId === s.userClubId) {
    addNews(s, 'transfer', `${fullName(p)} : ${from} → ${buyer.name}`, `${fullName(p)} (${p.age} ans) rejoint ${buyer.name} ${feeText}. Salaire : ${formatK(wage)} par semaine.`, ids);
  }
}

/**
 * Offre d'indemnité du club de l'utilisateur. En cas d'accord (ou pour un joueur libre),
 * il reste à négocier le contrat avec le joueur (voir contracts.ts).
 */
export function userBid(s: GameState, playerId: string, amount: number, rng: Rng): TransferOutcome {
  const p = playerById(s, playerId);
  const user = clubById(s, s.userClubId);
  if (!p || p.clubId === s.userClubId) return { ok: false, message: 'Joueur introuvable.' };
  if (squadOf(s, s.userClubId).length >= MAX_SQUAD) return { ok: false, message: `Effectif complet (${MAX_SQUAD} joueurs maximum). Vendez ou libérez un joueur d'abord.` };
  if (amount > user.transferBudget) return { ok: false, message: `Budget transferts insuffisant (${formatM(user.transferBudget)} disponibles).` };
  if (user.reputation < requiredReputation(p)) return { ok: false, message: `${fullName(p)} ne souhaite pas rejoindre un club de la stature de ${user.name}.` };
  if (p.talksBlockedUntil > nowStamp(s)) return { ok: false, message: `${fullName(p)} refuse de discuter avec vous pour le moment.` };
  if (!p.clubId) return { ok: true, stage: 'contract', message: `${fullName(p)} est libre : négociez directement son contrat.` };

  const seller = clubById(s, p.clubId);
  const agree = (msg: string): TransferOutcome => {
    s.feeAgreements = [...s.feeAgreements.filter((a) => a.playerId !== p.id), { playerId: p.id, fee: amount, expires: nowStamp(s) + 2 }];
    return { ok: true, stage: 'contract', message: msg };
  };
  if (p.releaseClause !== null && amount >= p.releaseClause) {
    return agree(`Clause libératoire levée : ${seller.name} ne peut pas s'opposer au départ. Négociez le contrat de ${fullName(p)}.`);
  }
  if (squadOf(s, seller.id).length <= MIN_SQUAD) return { ok: false, message: `${seller.name} refuse : son effectif est déjà trop réduit.` };
  const ask = roundMoney(priceFor(s, p) * (1 - fx(s, 'feeDiscount')));
  if (amount >= ask || (amount >= ask * 0.85 && rng.chance(0.4))) {
    return agree(`${seller.name} accepte ${formatM(amount)}. Il reste à convaincre ${fullName(p)} (2 semaines).`);
  }
  if (amount >= ask * 0.6) return { ok: false, counter: ask, message: `${seller.name} refuse mais se dit prêt à vendre pour ${formatM(ask)}.` };
  return { ok: false, message: `${seller.name} juge l'offre insultante et la rejette.` };
}

export function canLeaveUserSquad(s: GameState, p: Player): string | null {
  const squad = squadOf(s, s.userClubId);
  if (squad.length <= MIN_SQUAD) return `Votre effectif doit compter au moins ${MIN_SQUAD} joueurs.`;
  if (p.position === 'GK' && squad.filter((x) => x.position === 'GK').length <= 2) return 'Vous devez garder au moins deux gardiens.';
  return null;
}

/** Résiliation : le club verse la moitié des salaires restants du contrat. */
export function severanceFor(p: Player): number {
  return roundMoney(p.wage * 52 * Math.max(0, p.contractYears) * 0.5);
}

export function userRelease(s: GameState, playerId: string, ids: IdGen): TransferOutcome {
  const p = playerById(s, playerId);
  if (!p || p.clubId !== s.userClubId) return { ok: false, message: 'Joueur introuvable.' };
  const blocked = canLeaveUserSquad(s, p);
  if (blocked) return { ok: false, message: blocked };
  const cost = severanceFor(p);
  addMoney(s, s.userClubId, 'severance', -cost, `Résiliation de ${fullName(p)}`);
  const user = clubById(s, s.userClubId);
  user.tactic.lineup = user.tactic.lineup.map((id) => (id === p.id ? null : id));
  p.clubId = null;
  p.transferListed = false;
  p.contractYears = 0;
  p.releaseClause = null;
  addNews(s, 'transfer', `${fullName(p)} libéré`, `Le contrat de ${fullName(p)} a été résilié. Indemnité versée : ${formatM(cost)}.`, ids);
  return { ok: true, message: `${fullName(p)} est libéré (indemnité ${formatM(cost)}).` };
}

export function respondToOffer(s: GameState, offerId: string, accept: boolean, ids: IdGen): TransferOutcome {
  const offer = s.offers.find((o) => o.id === offerId);
  if (!offer || offer.status !== 'pending') return { ok: false, message: 'Offre expirée.' };
  const p = playerById(s, offer.playerId);
  const club = clubById(s, offer.fromClubId);
  if (!p || p.clubId !== s.userClubId) {
    offer.status = 'expired';
    return { ok: false, message: 'Le joueur ne fait plus partie de votre effectif.' };
  }
  if (!accept) {
    offer.status = 'rejected';
    // Un joueur qui voulait partir le vit mal.
    if (p.transferListed || p.morale < 40) p.morale = Math.max(5, p.morale - 6);
    return { ok: true, message: `Offre de ${club.name} refusée.` };
  }
  const blocked = canLeaveUserSquad(s, p);
  if (blocked) return { ok: false, message: blocked };
  if (club.transferBudget < offer.amount) {
    offer.status = 'expired';
    return { ok: false, message: `${club.name} n'a plus les fonds nécessaires.` };
  }
  offer.status = 'accepted';
  executeTransfer(s, p, club.id, offer.amount, wageDemand(p), ids);
  return { ok: true, message: `${fullName(p)} est vendu à ${club.name} pour ${formatM(offer.amount)}.` };
}

/** Activité hebdomadaire du marché : offres reçues, clauses libératoires, transferts entre clubs IA, joueurs libres. */
export function weeklyMarket(s: GameState, rng: Rng, ids: IdGen): void {
  s.offers.forEach((o) => {
    if (o.status === 'pending' && s.currentWeek - o.week >= 2) o.status = 'expired';
  });
  s.feeAgreements = s.feeAgreements.filter((a) => a.expires >= nowStamp(s));

  const userSquad = squadOf(s, s.userClubId);
  const saleBonus = 1 + fx(s, 'salePrice');

  // 1. Clauses libératoires : un club riche peut lever la clause d'un joueur de l'utilisateur.
  for (const p of userSquad) {
    if (p.releaseClause === null || !rng.chance(0.03) || canLeaveUserSquad(s, p)) continue;
    const buyer = s.clubs.find((c) => c.id !== s.userClubId && c.transferBudget >= p.releaseClause! && c.reputation >= requiredReputation(p) - 5);
    if (!buyer) continue;
    addNews(s, 'transfer', `Clause libératoire levée pour ${fullName(p)}`, `${buyer.name} paie la clause de ${formatM(p.releaseClause)} : vous ne pouvez pas vous y opposer.`, ids);
    executeTransfer(s, p, buyer.id, p.releaseClause, wageDemand(p), ids);
    break;
  }

  // 2. Offres pour les joueurs du club de l'utilisateur.
  const pending = s.offers.filter((o) => o.status === 'pending').length;
  if (pending < 3) {
    for (const p of squadOf(s, s.userClubId)) {
      // Un joueur mécontent attire davantage les convoitises (son agent le propose).
      const prob = p.transferListed ? 0.3 : p.morale < 30 ? 0.06 : 0.012;
      if (!rng.chance(prob)) continue;
      const value = marketValue(p);
      const amount = roundMoney(value * saleBonus * (p.transferListed ? rng.float(0.7, 1.05) : rng.float(1.05, 1.45)));
      const bidders = s.clubs.filter((c) => c.id !== s.userClubId && c.transferBudget >= amount && c.reputation >= requiredReputation(p) - 15);
      if (!bidders.length) continue;
      const club = rng.pick(bidders);
      s.offers.push({ id: ids('o'), playerId: p.id, fromClubId: club.id, amount, week: s.currentWeek, status: 'pending' });
      addNews(s, 'transfer', `Offre de ${club.name}`, `${club.name} propose ${formatM(amount)} pour ${fullName(p)}. Répondez depuis le marché des transferts.`, ids);
      break;
    }
  }

  // 3. Transferts entre clubs IA (rares).
  if (rng.chance(0.18)) {
    const buyer = rng.pick(s.clubs.filter((c) => c.id !== s.userClubId));
    const targets = s.players.filter(
      (p) => p.clubId && !p.youth && p.clubId !== s.userClubId && p.clubId !== buyer.id && p.transferListed && priceFor(s, p) <= buyer.transferBudget,
    );
    if (targets.length && squadOf(s, buyer.id).length < 28) {
      const p = rng.pick(targets);
      if (squadOf(s, p.clubId!).length > MIN_SQUAD + 2) executeTransfer(s, p, buyer.id, priceFor(s, p), wageDemand(p), ids);
    }
  }

  // 4. Les clubs IA en sous-effectif recrutent un joueur libre au poste manquant.
  for (const club of s.clubs) {
    if (club.id === s.userClubId) continue;
    const squad = squadOf(s, club.id);
    if (squad.length >= 22) continue;
    const groups = ['GK', 'DEF', 'MID', 'ATT'] as const;
    const need = groups.map((g) => ({ g, n: squad.filter((p) => POSITION_GROUP[p.position] === g && isAvailable(p)).length })).sort((a, b) => a.n - b.n)[0].g;
    const free = s.players.filter((p) => !p.clubId && POSITION_GROUP[p.position] === need).sort((a, b) => b.rating - a.rating)[0];
    if (free) executeTransfer(s, free, club.id, 0, wageDemand(free), ids);
  }
}

export const formatM = (v: number) => (Math.abs(v) >= 1_000_000 ? `${(v / 1_000_000).toFixed(1).replace('.', ',')} M€` : `${Math.round(v / 1000)} k€`);
export const formatK = (v: number) => `${Math.round(v / 1000).toLocaleString('fr-FR')} k€`;

/** Utilitaire pour l'interface : masse salariale actuelle du club de l'utilisateur. */
export const userWageBill = (s: GameState) => wageBill(squadOf(s, s.userClubId));
