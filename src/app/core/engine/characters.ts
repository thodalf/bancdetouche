import { NAME_POOLS } from '../data/names.data';
import { EffectKey, Effects, GameState, LifestyleId, StaffMember, StaffRole, STAFF_ROLE_LABELS, TraitId } from '../models';
import { clamp } from './player-factory';
import { Rng } from './rng';
import { roundMoney } from './valuation';
import { addMoney, addNews, clubById, IdGen } from './world';

// ------------------------------------------------------------------ libellés des effets

export interface EffectInfo {
  label: string;
  /** 'pct' : fraction affichée en %, 'flat' : valeur brute. */
  unit: 'pct' | 'flat';
  /** true quand une valeur négative est bonne (risque de blessure, exigences salariales…). */
  lowerIsBetter?: boolean;
}

export const EFFECT_INFO: Record<EffectKey, EffectInfo> = {
  matchStrength: { label: 'Force en match', unit: 'pct' },
  subEnergy: { label: 'Endurance rendue par remplacement', unit: 'flat' },
  recovery: { label: 'Récupération', unit: 'pct' },
  injuryRisk: { label: 'Risque de blessure', unit: 'pct', lowerIsBetter: true },
  injuryDuration: { label: 'Durée des blessures', unit: 'pct', lowerIsBetter: true },
  scoutSpeed: { label: 'Vitesse du scouting', unit: 'pct' },
  scoutAccuracy: { label: 'Fiabilité des rapports', unit: 'flat' },
  boosterQuality: { label: 'Qualité des boosters', unit: 'flat' },
  youthGrowth: { label: 'Progression des jeunes', unit: 'pct' },
  youthPotential: { label: 'Potentiel des promotions', unit: 'flat' },
  intakeSize: { label: 'Jeunes par promotion', unit: 'flat' },
  wageDemands: { label: 'Exigences salariales', unit: 'pct', lowerIsBetter: true },
  salePrice: { label: 'Prix de vente', unit: 'pct' },
  feeDiscount: { label: 'Rabais sur les indemnités', unit: 'pct' },
  negotiationRounds: { label: 'Tentatives de négociation', unit: 'flat' },
  morale: { label: 'Moral (par semaine)', unit: 'flat' },
  boardConfidence: { label: 'Confiance de la direction (par victoire)', unit: 'flat' },
  income: { label: 'Recettes', unit: 'pct' },
  upkeep: { label: 'Entretien des infrastructures', unit: 'pct', lowerIsBetter: true },
};

export function formatEffect(key: EffectKey, value: number): string {
  const info = EFFECT_INFO[key];
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  const abs = Math.abs(value);
  const body = info.unit === 'pct' ? `${(abs * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %` : abs.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
  return `${sign}${body}`;
}

/** Un effet est-il favorable au club ? (pour la couleur dans l'interface) */
export const isGood = (key: EffectKey, value: number) => (EFFECT_INFO[key].lowerIsBetter ? value < 0 : value > 0);

// ------------------------------------------------------------------ traits

export interface TraitDef {
  id: TraitId;
  label: string;
  description: string;
  effects?: Effects;
  /** Multiplicateur de l'effet de poste. */
  roleMultiplier?: number;
  /** Multiplicateur de salaire. */
  wageMultiplier?: number;
  /** Traits incompatibles. */
  opposite?: TraitId;
}

export const TRAITS: Record<TraitId, TraitDef> = {
  charismatic: { id: 'charismatic', label: 'Charismatique', description: 'Le vestiaire l’écoute : le moral monte chaque semaine.', effects: { morale: 0.8 } },
  perfectionist: { id: 'perfectionist', label: 'Perfectionniste', description: 'Travail d’excellence, mais vit mal chaque défaite.', roleMultiplier: 1.15, opposite: 'lazy' },
  lazy: { id: 'lazy', label: 'Paresseux', description: 'Fait le minimum. Peu exigeant sur le salaire.', roleMultiplier: 0.8, wageMultiplier: 0.85, opposite: 'perfectionist' },
  ambitious: { id: 'ambitious', label: 'Ambitieux', description: 'Progresse vite mais supporte mal la médiocrité ; peut partir pour mieux.', opposite: 'loyal' },
  loyal: { id: 'loyal', label: 'Loyal', description: 'Ne vous lâchera jamais : opinion plancher de 40, insensible aux offres.', opposite: 'ambitious' },
  greedy: { id: 'greedy', label: 'Avide', description: 'Coûte cher, mais négocie âprement chaque euro.', wageMultiplier: 1.25, effects: { wageDemands: -0.03, income: 0.02 } },
  diplomat: { id: 'diplomat', label: 'Diplomate', description: 'Arrondit les angles avec les agents, les clubs et la direction.', effects: { wageDemands: -0.04, salePrice: 0.04, boardConfidence: 0.5 } },
  visionary: { id: 'visionary', label: 'Visionnaire', description: 'Repère le talent avant tout le monde.', effects: { scoutAccuracy: 10, boosterQuality: 3 } },
  globetrotter: { id: 'globetrotter', label: 'Globe-trotteur', description: 'Un carnet d’adresses sur tous les continents.', effects: { scoutSpeed: 0.15 } },
  meticulous: { id: 'meticulous', label: 'Méticuleux', description: 'Rien n’est laissé au hasard.', effects: { injuryRisk: -0.06 } },
  hothead: { id: 'hothead', label: 'Colérique', description: 'Galvanise en match, use les nerfs le reste du temps.', effects: { matchStrength: 0.01, morale: -0.5 } },
  veteran: { id: 'veteran', label: 'Vétéran', description: 'Des décennies de métier.', roleMultiplier: 1.1 },
  innovator: { id: 'innovator', label: 'Innovateur', description: 'Méthodes modernes : jeunes et récupération en profitent.', effects: { youthGrowth: 0.08, recovery: 0.05 } },
};

// ------------------------------------------------------------------ postes

/** Effet de base d'un poste selon la compétence (1-20). */
export const ROLE_EFFECTS: Record<StaffRole, (skill: number) => Effects> = {
  assistant: (k) => ({ matchStrength: k * 0.0025, subEnergy: k * 0.15 }),
  fitness: (k) => ({ recovery: k * 0.012, injuryRisk: -k * 0.01 }),
  doctor: (k) => ({ injuryDuration: -k * 0.015 }),
  scout: (k) => ({ scoutSpeed: k * 0.015, scoutAccuracy: k * 0.6 }),
  youth: (k) => ({ youthGrowth: k * 0.012, youthPotential: k * 0.2 }),
  director: (k) => ({ wageDemands: -k * 0.004, salePrice: k * 0.004, feeDiscount: k * 0.003 }),
};

export const SINGLE_ROLES: StaffRole[] = ['assistant', 'fitness', 'doctor', 'youth', 'director'];
export const ROLE_ORDER: StaffRole[] = ['assistant', 'fitness', 'doctor', 'youth', 'director', 'scout'];

export const maxScouts = (s: GameState) => clubById(s, s.userClubId).facilities.scouting;

/** Opinion → motivation : un membre du staff démotivé rend moins. */
const motivation = (opinion: number) => (opinion < 30 ? 0.85 : opinion > 75 ? 1.05 : 1);

export function staffEffects(m: StaffMember): Effects {
  const mult = m.traits.reduce((acc, t) => acc * (TRAITS[t].roleMultiplier ?? 1), 1) * motivation(m.opinion);
  const out: Effects = {};
  for (const [k, v] of Object.entries(ROLE_EFFECTS[m.role](m.skill)) as [EffectKey, number][]) out[k] = v * mult;
  for (const t of m.traits) for (const [k, v] of Object.entries(TRAITS[t].effects ?? {}) as [EffectKey, number][]) out[k] = (out[k] ?? 0) + v;
  return out;
}

// ------------------------------------------------------------------ modes de vie (avantages)

export interface PerkDef {
  id: string;
  label: string;
  description: string;
  effects: Effects;
}

export interface LifestyleDef {
  id: LifestyleId;
  label: string;
  description: string;
  perks: PerkDef[];
}

export const LIFESTYLES: Record<LifestyleId, LifestyleDef> = {
  tactician: {
    id: 'tactician',
    label: 'Tacticien',
    description: 'Le match se gagne au tableau noir.',
    perks: [
      { id: 'tac1', label: 'Lecture du jeu', description: 'Vos consignes sont mieux appliquées.', effects: { matchStrength: 0.015 } },
      { id: 'tac2', label: 'Coaching gagnant', description: 'Les entrants apportent un vrai second souffle.', effects: { subEnergy: 3 } },
      { id: 'tac3', label: 'Plans de rechange', description: 'Votre équipe s’adapte à tous les scénarios.', effects: { matchStrength: 0.015 } },
      { id: 'tac4', label: 'Génie tactique', description: 'Vos équipes jouent au-dessus de leur valeur.', effects: { matchStrength: 0.025 } },
    ],
  },
  mentor: {
    id: 'mentor',
    label: 'Formateur',
    description: 'Construire l’avenir avec les jeunes du club.',
    perks: [
      { id: 'men1', label: 'Œil pour le talent', description: 'Les jeunes progressent plus vite.', effects: { youthGrowth: 0.1 } },
      { id: 'men2', label: 'Réseau de détection', description: 'Un jeune de plus à chaque promotion.', effects: { intakeSize: 1 } },
      { id: 'men3', label: 'Pédagogue', description: 'Les promotions ont plus de potentiel.', effects: { youthPotential: 3 } },
      { id: 'men4', label: 'Pépinière', description: 'Le centre de formation devient une référence.', effects: { youthGrowth: 0.15, youthPotential: 2 } },
    ],
  },
  negotiator: {
    id: 'negotiator',
    label: 'Négociateur',
    description: 'Le mercato est votre terrain de jeu.',
    perks: [
      { id: 'neg1', label: 'Poignée de main ferme', description: 'Les agents baissent leurs exigences.', effects: { wageDemands: -0.04 } },
      { id: 'neg2', label: 'Patience', description: 'Une tentative de négociation supplémentaire.', effects: { negotiationRounds: 1 } },
      { id: 'neg3', label: 'Vendeur redoutable', description: 'Vos joueurs se vendent plus cher.', effects: { salePrice: 0.06 } },
      { id: 'neg4', label: 'Maître du mercato', description: 'Les clubs vous consentent des rabais.', effects: { feeDiscount: 0.08, wageDemands: -0.03 } },
    ],
  },
  leader: {
    id: 'leader',
    label: 'Meneur d’hommes',
    description: 'Un vestiaire uni vaut tous les systèmes.',
    perks: [
      { id: 'lea1', label: 'Discours de vestiaire', description: 'Le moral monte chaque semaine.', effects: { morale: 0.8 } },
      { id: 'lea2', label: 'Homme de confiance', description: 'La direction vous soutient davantage.', effects: { boardConfidence: 0.8 } },
      { id: 'lea3', label: 'Exigence', description: 'Vos joueurs se dépassent.', effects: { matchStrength: 0.015, morale: 0.4 } },
      { id: 'lea4', label: 'Légende du banc', description: 'Votre aura rejaillit sur tout le club.', effects: { morale: 0.8, boardConfidence: 0.7 } },
    ],
  },
  steward: {
    id: 'steward',
    label: 'Gestionnaire',
    description: 'Un club sain est un club qui gagne longtemps.',
    perks: [
      { id: 'ste1', label: 'Rigueur budgétaire', description: 'Infrastructures moins coûteuses à entretenir.', effects: { upkeep: -0.15 } },
      { id: 'ste2', label: 'Partenariats', description: 'Les recettes augmentent.', effects: { income: 0.04 } },
      { id: 'ste3', label: 'Médecine préventive', description: 'Moins de blessures, plus courtes.', effects: { injuryRisk: -0.06, injuryDuration: -0.1 } },
      { id: 'ste4', label: 'Modèle économique', description: 'Le club tourne à plein régime.', effects: { income: 0.06, upkeep: -0.1 } },
    ],
  },
};

export function selectLifestyle(s: GameState, id: LifestyleId): void {
  s.manager.lifestyle = id;
}

export function unlockPerk(s: GameState, perkId: string): { ok: boolean; message: string } {
  const m = s.manager;
  if (!m.lifestyle) return { ok: false, message: 'Choisissez d’abord un mode de vie.' };
  const tree = LIFESTYLES[m.lifestyle].perks;
  const idx = tree.findIndex((p) => p.id === perkId);
  if (idx < 0) return { ok: false, message: 'Cet avantage n’appartient pas à votre mode de vie actuel.' };
  if (m.perks.includes(perkId)) return { ok: false, message: 'Avantage déjà obtenu.' };
  if (idx > 0 && !m.perks.includes(tree[idx - 1].id)) return { ok: false, message: `Débloquez d’abord « ${tree[idx - 1].label} ».` };
  if (m.perkPoints <= 0) return { ok: false, message: 'Aucun point d’avantage : montez de niveau en gagnant des matchs.' };
  m.perkPoints--;
  m.perks.push(perkId);
  return { ok: true, message: `Avantage « ${tree[idx].label} » obtenu.` };
}

const ALL_PERKS = new Map(Object.values(LIFESTYLES).flatMap((l) => l.perks.map((p) => [p.id, p] as const)));

// ------------------------------------------------------------------ agrégation

export interface EffectSource {
  label: string;
  kind: 'staff' | 'perk' | 'modifier';
  effects: Effects;
}

export function effectSources(s: GameState): EffectSource[] {
  const out: EffectSource[] = [];
  for (const m of s.staff ?? []) out.push({ label: `${m.firstName} ${m.lastName} (${STAFF_ROLE_LABELS[m.role].toLowerCase()})`, kind: 'staff', effects: staffEffects(m) });
  for (const id of s.manager.perks ?? []) {
    const p = ALL_PERKS.get(id);
    if (p) out.push({ label: `Avantage : ${p.label}`, kind: 'perk', effects: p.effects });
  }
  for (const mod of s.modifiers ?? []) out.push({ label: mod.label, kind: 'modifier', effects: mod.effects });
  return out;
}

/** Somme de tous les effets actifs pour le club de l'entraîneur. */
export function totalEffects(s: GameState): Effects {
  const total: Effects = {};
  for (const src of effectSources(s)) for (const [k, v] of Object.entries(src.effects) as [EffectKey, number][]) total[k] = (total[k] ?? 0) + v;
  // Les recruteurs ne cumulent pas leur fiabilité : on garde le meilleur.
  const scouts = (s.staff ?? []).filter((m) => m.role === 'scout');
  if (scouts.length > 1) {
    const sum = scouts.reduce((acc, m) => acc + (staffEffects(m).scoutAccuracy ?? 0), 0);
    const best = Math.max(...scouts.map((m) => staffEffects(m).scoutAccuracy ?? 0));
    total.scoutAccuracy = (total.scoutAccuracy ?? 0) - sum + best;
  }
  return total;
}

/** Raccourci : valeur d'un effet (0 si absent). */
export const fx = (s: GameState, key: EffectKey) => (s.staff ? (totalEffects(s)[key] ?? 0) : 0);

// ------------------------------------------------------------------ génération et gestion du staff

const TRAIT_IDS = Object.keys(TRAITS) as TraitId[];

export function staffWage(skill: number, traits: TraitId[]): number {
  const mult = traits.reduce((acc, t) => acc * (TRAITS[t].wageMultiplier ?? 1), 1);
  return roundMoney((1_500 + skill * skill * 55) * mult);
}

export function generateStaff(rng: Rng, ids: IdGen, role: StaffRole, meanSkill: number): StaffMember {
  const pool = rng.weighted(NAME_POOLS, (p) => p.weight);
  const traits: TraitId[] = [];
  const count = rng.weighted([1, 2, 3], (n) => (n === 2 ? 5 : n === 1 ? 3 : 2));
  while (traits.length < count) {
    const t = rng.pick(TRAIT_IDS);
    if (traits.includes(t) || traits.some((x) => TRAITS[x].opposite === t || TRAITS[t].opposite === x)) continue;
    traits.push(t);
  }
  const age = traits.includes('veteran') ? rng.int(52, 64) : rng.int(29, 58);
  const skill = Math.round(clamp(rng.normal(meanSkill, 3), 2, 20));
  return {
    id: ids('s'),
    firstName: rng.pick(pool.first),
    lastName: rng.pick(pool.last),
    nationality: pool.nationality,
    age,
    role,
    skill,
    traits,
    opinion: rng.int(50, 65),
    wage: staffWage(skill, traits),
    contractYears: rng.int(1, 3),
    missionId: null,
  };
}

/** Staff de départ du club : niveau en rapport avec le club. */
export function initialStaff(s: GameState, rng: Rng, ids: IdGen): StaffMember[] {
  const club = clubById(s, s.userClubId);
  const mean = 4 + club.level * 2;
  return ROLE_ORDER.map((role) => generateStaff(rng, ids, role, mean));
}

export function refreshStaffMarket(s: GameState, rng: Rng, ids: IdGen): void {
  const club = clubById(s, s.userClubId);
  s.staffMarket = Array.from({ length: 10 }, (_, i) => generateStaff(rng, ids, ROLE_ORDER[i % ROLE_ORDER.length], 5 + club.level * 2 + rng.int(-2, 5)));
}

/** Réputation minimale pour attirer un membre du staff de ce niveau. */
export const staffRequiredReputation = (skill: number) => clamp(skill * 4 - 10, 0, 90);

export function hireStaff(s: GameState, candidateId: string, ids: IdGen): { ok: boolean; message: string } {
  const c = s.staffMarket.find((x) => x.id === candidateId);
  if (!c) return { ok: false, message: 'Ce candidat n’est plus disponible.' };
  const club = clubById(s, s.userClubId);
  if (club.reputation < staffRequiredReputation(c.skill)) return { ok: false, message: `${c.firstName} ${c.lastName} vise un club plus prestigieux.` };
  if (c.role === 'scout' && s.staff.filter((m) => m.role === 'scout').length >= maxScouts(s)) {
    return { ok: false, message: `Votre cellule de recrutement ne peut accueillir que ${maxScouts(s)} recruteur(s). Améliorez-la ou libérez un recruteur.` };
  }
  const signing = c.wage * 4;
  if (club.balance < signing) return { ok: false, message: 'Trésorerie insuffisante pour la prime d’arrivée.' };
  if (SINGLE_ROLES.includes(c.role)) {
    const current = s.staff.find((m) => m.role === c.role);
    if (current) dismiss(s, current, ids, true);
  }
  addMoney(s, club.id, 'staff', -signing, `Prime d’arrivée : ${c.firstName} ${c.lastName}`);
  s.staffMarket = s.staffMarket.filter((x) => x.id !== c.id);
  s.staff.push({ ...c, opinion: 60 });
  addNews(s, 'staff', `${c.firstName} ${c.lastName} rejoint le staff`, `Nouveau ${STAFF_ROLE_LABELS[c.role].toLowerCase()} (compétence ${c.skill}/20).`, ids);
  return { ok: true, message: `${c.firstName} ${c.lastName} est engagé.` };
}

function dismiss(s: GameState, m: StaffMember, ids: IdGen, replaced: boolean): void {
  const severance = m.wage * 8;
  addMoney(s, s.userClubId, 'staff', -severance, `Indemnité de départ : ${m.firstName} ${m.lastName}`);
  s.staff = s.staff.filter((x) => x.id !== m.id);
  s.missions = s.missions.filter((x) => x.staffId !== m.id);
  // Un renvoi inquiète le reste du staff.
  s.staff.forEach((x) => (x.opinion = clamp(x.opinion - 3, 0, 100)));
  addNews(s, 'staff', `${m.firstName} ${m.lastName} quitte le club`, replaced ? 'Remplacé à son poste.' : 'Licencié par l’entraîneur.', ids);
}

export function fireStaff(s: GameState, id: string, ids: IdGen): { ok: boolean; message: string } {
  const m = s.staff.find((x) => x.id === id);
  if (!m) return { ok: false, message: 'Introuvable.' };
  dismiss(s, m, ids, false);
  return { ok: true, message: `${m.firstName} ${m.lastName} est remercié (indemnité de 8 semaines de salaire).` };
}

/** Évolution hebdomadaire : salaires, opinion, démissions. */
export function weeklyStaff(s: GameState, rng: Rng, ids: IdGen, aboveTarget: boolean): void {
  if (!s.staff?.length) return;
  const wages = s.staff.reduce((sum, m) => sum + m.wage, 0);
  addMoney(s, s.userClubId, 'staff', -wages, 'Salaires du staff');
  for (const m of [...s.staff]) {
    let delta = (55 - m.opinion) * 0.03;
    if (m.traits.includes('ambitious') && !aboveTarget) delta -= 1;
    m.opinion = clamp(m.opinion + delta, m.traits.includes('loyal') ? 40 : 0, 100);
    if (m.opinion < 15 && rng.chance(0.12)) {
      s.staff = s.staff.filter((x) => x.id !== m.id);
      s.missions = s.missions.filter((x) => x.staffId !== m.id);
      addNews(s, 'staff', `Démission de ${m.firstName} ${m.lastName}`, `Votre ${STAFF_ROLE_LABELS[m.role].toLowerCase()} ne supportait plus la situation et claque la porte.`, ids);
    }
  }
}

/** Réaction du staff au résultat d'un match. */
export function staffAfterMatch(s: GameState, result: 'W' | 'D' | 'L'): void {
  for (const m of s.staff ?? []) {
    const d = result === 'W' ? 1.5 : result === 'L' ? (m.traits.includes('perfectionist') ? -3 : -1.5) : 0;
    m.opinion = clamp(m.opinion + d, m.traits.includes('loyal') ? 40 : 0, 100);
  }
}

/** Intersaison : vieillissement, progression, retraites et débauchages. */
export function seasonStaff(s: GameState, rng: Rng, ids: IdGen): void {
  for (const m of [...(s.staff ?? [])]) {
    m.age++;
    if (m.traits.includes('ambitious')) m.skill = Math.min(20, m.skill + 1);
    else if (m.age < 45 && rng.chance(0.4)) m.skill = Math.min(20, m.skill + 1);
    else if (m.age > 60 && rng.chance(0.4)) m.skill = Math.max(1, m.skill - 1);
    const retires = m.age >= 66 || (m.age >= 62 && rng.chance(0.3));
    const poached = !m.traits.includes('loyal') && m.skill >= 15 && m.opinion < 60 && rng.chance(0.3);
    if (retires || poached) {
      s.staff = s.staff.filter((x) => x.id !== m.id);
      addNews(
        s,
        'staff',
        retires ? `${m.firstName} ${m.lastName} prend sa retraite` : `${m.firstName} ${m.lastName} débauché`,
        retires ? `Après une longue carrière, votre ${STAFF_ROLE_LABELS[m.role].toLowerCase()} se retire.` : 'Un club plus prestigieux lui a fait une offre qu’il n’a pas refusée.',
        ids,
      );
    }
  }
  refreshStaffMarket(s, rng, ids);
}
