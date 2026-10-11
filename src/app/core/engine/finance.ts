import { Club, Player } from '../models';
import { clamp } from './player-factory';
import { roundMoney } from './valuation';

/** Revenus de sponsoring hebdomadaires. */
export const weeklySponsor = (c: Club) => roundMoney(c.reputation * c.reputation * 25);

/** Droits TV versés à chaque journée de championnat. */
export const tvRights = (c: Club) => roundMoney(40_000 + c.reputation * c.reputation * 60);

/** Frais de fonctionnement hebdomadaires (staff, stade, déplacements). */
export const runningCosts = (c: Club) => roundMoney(c.capacity * 8);

export function attendance(c: Club, opponentReputation: number, isCup: boolean): number {
  const appeal = 0.4 + c.reputation / 200 + (c.morale - 50) / 400 + opponentReputation / 600 + (isCup ? 0.05 : 0);
  return Math.round(c.capacity * clamp(appeal, 0.25, 1));
}

/** Part nette de la billetterie (après frais d'organisation du match). */
export const gateReceipts = (c: Club, crowd: number) => Math.round(crowd * c.ticketPrice * 0.6);

export const wageBill = (squad: Player[]) => squad.reduce((sum, p) => sum + p.wage, 0);

/** Primes de coupe par tour atteint (index = tour joué et gagné). */
export const CUP_PRIZES = [400_000, 800_000, 1_500_000, 4_000_000];

/** Prime de fin de saison selon le classement (1er = index 0). */
export function leaguePrize(position: number, clubCount: number): number {
  const base = (clubCount - position + 1) * 1_200_000;
  return position === 1 ? base + 10_000_000 : base;
}
