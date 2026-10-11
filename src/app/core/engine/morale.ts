import { Player, SQUAD_STATUS_LABELS, STATUS_EXPECTED_SHARE } from '../models';
import { clamp } from './player-factory';

export const RECENT_WINDOW = 6;

export type MoraleLevel = 'superb' | 'good' | 'okay' | 'poor' | 'very-poor';

export function moraleLevel(m: number): MoraleLevel {
  if (m >= 80) return 'superb';
  if (m >= 62) return 'good';
  if (m >= 45) return 'okay';
  if (m >= 28) return 'poor';
  return 'very-poor';
}

export const MORALE_LABELS: Record<MoraleLevel, string> = {
  superb: 'Excellent',
  good: 'Bon',
  okay: 'Correct',
  poor: 'Mauvais',
  'very-poor': 'Très mauvais',
};

/** Part des derniers matchs joués. */
export function playingShare(p: Player): number | null {
  if (p.recentApps.length < 3) return null;
  return p.recentApps.filter(Boolean).length / p.recentApps.length;
}

/**
 * Mise à jour du moral après un match du club :
 * résultat collectif, performance individuelle et temps de jeu comparé au statut promis.
 */
export function updateMoraleAfterMatch(p: Player, played: boolean, result: 'W' | 'D' | 'L', matchRating?: number): void {
  p.recentApps = [...p.recentApps, played].slice(-RECENT_WINDOW);
  let delta = result === 'W' ? 2 : result === 'L' ? -2 : 0;
  if (played) {
    delta += result === 'W' ? 1 : result === 'L' ? -1 : 0;
    if (matchRating !== undefined) delta += (matchRating - 6.5) * 2;
  }
  // Un blessé ne reproche pas son temps de jeu à l'entraîneur.
  const share = playingShare(p);
  if (share !== null && p.injuryWeeks === 0) {
    const expected = STATUS_EXPECTED_SHARE[p.squadStatus];
    if (share < expected - 0.25) delta -= 4;
    else if (share < expected - 0.1) delta -= 2;
    else if (share >= expected) delta += 1;
  }
  // Légère attraction vers un moral neutre.
  delta += (60 - p.morale) * 0.04;
  p.morale = Math.round(clamp(p.morale + delta, 5, 100));
}

/** Explication lisible du moral d'un joueur. */
export function moraleReason(p: Player): string {
  const share = playingShare(p);
  const expected = STATUS_EXPECTED_SHARE[p.squadStatus];
  if (share !== null && share < expected - 0.1 && p.injuryWeeks === 0) {
    return `Frustré par son temps de jeu : ${Math.round(share * 100)} % des derniers matchs pour un statut de « ${SQUAD_STATUS_LABELS[p.squadStatus]} ».`;
  }
  if (p.form >= 7) return 'Rassuré par ses bonnes performances.';
  if (p.form <= 3) return 'Touché par ses performances récentes.';
  if (share !== null && share >= expected) return 'Satisfait de son temps de jeu.';
  return 'Rien de particulier à signaler.';
}
