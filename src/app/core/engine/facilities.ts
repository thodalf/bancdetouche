import { Club, FACILITY_LABELS, FacilityKind, GameState } from '../models';
import { roundMoney } from './valuation';
import { addMoney, addNews, clubById, IdGen } from './world';

export const MAX_FACILITY_LEVEL = 5;

/** Coût et durée des travaux pour atteindre `level`. */
export function upgradeCost(kind: FacilityKind, level: number): { cost: number; weeks: number } {
  const base: Record<FacilityKind, number> = { stadium: 6_000_000, training: 3_500_000, academy: 2_800_000, scouting: 1_500_000 };
  const weeks: Record<FacilityKind, number> = { stadium: 14, training: 8, academy: 8, scouting: 4 };
  return { cost: roundMoney(base[kind] * Math.pow(level, 1.5)), weeks: weeks[kind] };
}

/** Entretien hebdomadaire des installations. */
export const facilitiesUpkeep = (c: Club) => roundMoney((c.facilities.training + c.facilities.academy + c.facilities.scouting) * 9_000 + c.facilities.stadium * 6_000);

export const FACILITY_EFFECTS: Record<FacilityKind, (level: number) => string> = {
  stadium: (l) => `Chaque niveau ajoute environ 15 % de places. Niveau ${l} : plus de billetterie et de prestige.`,
  training: (l) => `Récupération ${l >= 3 ? '+' : ''}${(l - 3) * 6} %, risque de blessure −${l * 6} %, progression des jeunes joueurs plus rapide.`,
  academy: (l) => `${2 + Math.floor(l / 2)} à ${3 + Math.floor(l / 2)} jeunes par promotion annuelle, potentiel plus élevé à chaque niveau.`,
  scouting: (l) => `${2 + l} joueurs observés en même temps, rapports ${l >= 4 ? 'très ' : ''}rapides.`,
};

export function startUpgrade(s: GameState, kind: FacilityKind, ids: IdGen): { ok: boolean; message: string } {
  const club = clubById(s, s.userClubId);
  if (club.construction) return { ok: false, message: `Des travaux sont déjà en cours (${FACILITY_LABELS[club.construction.kind]}).` };
  const level = club.facilities[kind];
  if (level >= MAX_FACILITY_LEVEL) return { ok: false, message: `${FACILITY_LABELS[kind]} est déjà au niveau maximal.` };
  const { cost, weeks } = upgradeCost(kind, level + 1);
  if (club.balance - cost < 0) return { ok: false, message: `Trésorerie insuffisante : les travaux coûtent ${(cost / 1e6).toFixed(1).replace('.', ',')} M€.` };
  addMoney(s, club.id, 'facilities', -cost, `Travaux : ${FACILITY_LABELS[kind]} niveau ${level + 1}`);
  club.construction = { kind, targetLevel: level + 1, weeksLeft: weeks };
  addNews(s, 'finance', `Travaux lancés : ${FACILITY_LABELS[kind]}`, `La direction valide l'investissement. Livraison prévue dans ${weeks} semaines.`, ids);
  return { ok: true, message: `Travaux lancés pour ${weeks} semaines.` };
}

/** Avancement hebdomadaire des chantiers de tous les clubs. */
export function progressConstruction(s: GameState, ids: IdGen): void {
  for (const club of s.clubs) {
    const c = club.construction;
    if (!c) continue;
    c.weeksLeft--;
    if (c.weeksLeft > 0) continue;
    club.facilities[c.kind] = c.targetLevel;
    if (c.kind === 'stadium') club.capacity = Math.round((club.capacity * 1.15) / 100) * 100;
    if (club.id === s.userClubId) {
      addNews(s, 'finance', `Inauguration : ${FACILITY_LABELS[c.kind]} niveau ${c.targetLevel}`, `Les travaux sont terminés. ${FACILITY_EFFECTS[c.kind](c.targetLevel)}`, ids);
    }
    club.construction = null;
  }
}
