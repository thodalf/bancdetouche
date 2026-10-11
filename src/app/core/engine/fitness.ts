import { Club, Player, TrainingIntensity } from '../models';
import { clamp } from './player-factory';
import { Rng } from './rng';

/** Catalogue des blessures : la gravité tirée détermine la durée. */
const INJURIES: { name: string; min: number; max: number; weight: number }[] = [
  { name: 'Contracture', min: 1, max: 1, weight: 30 },
  { name: 'Élongation', min: 1, max: 3, weight: 25 },
  { name: 'Entorse de la cheville', min: 2, max: 4, weight: 18 },
  { name: 'Contusion au genou', min: 1, max: 3, weight: 12 },
  { name: 'Déchirure musculaire', min: 4, max: 7, weight: 9 },
  { name: 'Fracture du métatarse', min: 6, max: 10, weight: 4 },
  { name: 'Rupture des ligaments croisés', min: 20, max: 30, weight: 1 },
];

export function rollInjury(rng: Rng, fatigue: number): { name: string; weeks: number } {
  // Un joueur épuisé se blesse plus gravement.
  const kind = rng.weighted(INJURIES, (i) => i.weight * (i.min >= 4 ? 1 + fatigue / 60 : 1));
  return { name: kind.name, weeks: rng.int(kind.min, kind.max) };
}

/** Effets de l'intensité d'entraînement. */
export const TRAINING_EFFECTS: Record<TrainingIntensity, { recovery: number; injury: number; growth: number; description: string }> = {
  light: { recovery: 1.3, injury: 0.75, growth: 0.5, description: 'Récupération rapide, moins de blessures, progression lente.' },
  normal: { recovery: 1, injury: 1, growth: 1, description: 'Équilibre entre récupération et progression.' },
  intense: { recovery: 0.75, injury: 1.35, growth: 1.6, description: 'Progression des jeunes accélérée, mais fatigue et blessures en hausse.' },
};

/** Multiplicateur du risque de blessure en match pour un club. */
export function injuryRiskFor(club: Club): number {
  return TRAINING_EFFECTS[club.trainingIntensity].injury * (1.1 - club.facilities.training * 0.06);
}

/** Récupération hebdomadaire : intensité d'entraînement + qualité du centre d'entraînement. */
export function weeklyRecovery(p: Player, club: Club | undefined, bonus = 0): void {
  const intensity = club ? TRAINING_EFFECTS[club.trainingIntensity].recovery : 1;
  const facility = club ? 1 + (club.facilities.training - 3) * 0.06 : 1;
  const amount = (18 + p.fatigue * 0.15) * intensity * facility * (1 + bonus);
  p.fatigue = Math.max(0, Math.round(p.fatigue - amount));
}

/** Progression en cours de saison des joueurs de 23 ans et moins (appelée toutes les 4 semaines). */
export function monthlyGrowth(p: Player, club: Club | undefined, rng: Rng, bonus = 0): boolean {
  if (p.age > 23 || p.rating >= p.potential || p.injuryWeeks > 0) return false;
  const growth = club ? TRAINING_EFFECTS[club.trainingIntensity].growth : 1;
  const facility = club ? club.facilities.training * 0.06 : 0.12;
  const chance = clamp((0.22 + facility) * growth * (p.age <= 19 ? 1.3 : 1) * (1 + bonus), 0, 0.95);
  if (!rng.chance(chance)) return false;
  p.rating = Math.min(p.potential, p.rating + 1);
  return true;
}
