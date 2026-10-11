import { Player } from '../models';

/** Arrondit une somme à 2 chiffres significatifs, pour des montants « lisibles ». */
export function roundMoney(value: number): number {
  if (value <= 0) return 0;
  const magnitude = Math.pow(10, Math.max(0, Math.floor(Math.log10(value)) - 1));
  return Math.round(value / magnitude) * magnitude;
}

function ageFactor(age: number, rating: number, potential: number): number {
  const growth = Math.max(0, potential - rating);
  if (age <= 21) return 1.2 + growth * 0.035;
  if (age <= 24) return 1.1 + growth * 0.02;
  if (age <= 28) return 1.0;
  if (age <= 30) return 0.8;
  if (age <= 32) return 0.55;
  return 0.3;
}

/** Valeur marchande en euros. Courbe exponentielle : 80 ≈ 15 M€, 90 ≈ 60 M€, 60 ≈ 1 M€. */
export function marketValue(p: Pick<Player, 'rating' | 'age' | 'potential' | 'contractYears'>): number {
  const base = 15_000_000 * Math.exp(0.1386 * (p.rating - 80));
  const contract = p.contractYears <= 1 ? 0.75 : 1;
  return roundMoney(Math.max(25_000, base * ageFactor(p.age, p.rating, p.potential) * contract));
}

/** Salaire hebdomadaire attendu par un joueur de ce niveau. */
export function expectedWage(p: Pick<Player, 'rating' | 'age' | 'potential'>): number {
  const base = 28_000 * Math.exp(0.08 * (p.rating - 80));
  const ageBoost = p.age >= 29 ? 1.15 : p.age <= 21 ? 0.7 : 1;
  return roundMoney(Math.max(1_200, base * ageBoost));
}

/** Prix demandé par un club IA pour son joueur. */
export function askingPrice(player: Player, isKeyPlayer: boolean): number {
  const value = marketValue(player);
  if (player.transferListed) return roundMoney(value * 0.9);
  return roundMoney(value * (isKeyPlayer ? 1.6 : 1.2));
}
