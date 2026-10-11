import { DEFAULT_INSTRUCTIONS, TeamInstructions, TeamStyle } from '../models';

/** Effets combinés de la mentalité et des consignes sur le moteur de match. */
export interface TacticalMods {
  att: number;
  def: number;
  mid: number;
  /** Fréquence des attaques (contribution de l'équipe au rythme du match). */
  tempo: number;
  /** Qualité des occasions créées. */
  shotQuality: number;
  /** Qualité des occasions concédées à l'adversaire. */
  concede: number;
  fouls: number;
  redRisk: number;
  /** Perte d'endurance supplémentaire par minute. */
  drain: number;
}

const STYLE: Record<TeamStyle, Pick<TacticalMods, 'att' | 'def' | 'tempo' | 'drain'>> = {
  ultraDefensive: { att: 0.86, def: 1.12, tempo: 0.75, drain: -0.04 },
  defensive: { att: 0.93, def: 1.07, tempo: 0.86, drain: -0.02 },
  balanced: { att: 1, def: 1, tempo: 1, drain: 0 },
  attacking: { att: 1.07, def: 0.93, tempo: 1.14, drain: 0.04 },
  ultraAttacking: { att: 1.1, def: 0.88, tempo: 1.25, drain: 0.1 },
};

export function tacticalMods(style: TeamStyle, i: TeamInstructions, leading: boolean, opponent?: TeamInstructions): TacticalMods {
  const st = STYLE[style] ?? STYLE.balanced;
  const m: TacticalMods = { att: st.att, def: st.def, mid: 1, tempo: st.tempo, shotQuality: 1, concede: 1, fouls: 1, redRisk: 1, drain: st.drain };

  // Pressing : récupère le ballon plus haut, mais épuise et expose.
  if (i.pressing === 'high') Object.assign(m, { mid: m.mid * 1.06, def: m.def * 0.98, fouls: m.fouls * 1.3, drain: m.drain + 0.22 });
  if (i.pressing === 'low') Object.assign(m, { mid: m.mid * 0.96, def: m.def * 1.03, fouls: m.fouls * 0.8, drain: m.drain - 0.06 });

  // Ligne défensive : haute = bloc compact mais dos exposé ; basse = surface protégée mais pression subie.
  if (i.line === 'high') Object.assign(m, { mid: m.mid * 1.04, concede: m.concede * 1.08 });
  if (i.line === 'deep') Object.assign(m, { def: m.def * 1.04, mid: m.mid * 0.97, concede: m.concede * 0.93 });

  // Passes : courtes = possession et occasions plus nettes ; directes = plus d'attaques, moins précises.
  if (i.passing === 'short') Object.assign(m, { mid: m.mid * 1.05, tempo: m.tempo * 0.9, shotQuality: m.shotQuality * 1.04 });
  if (i.passing === 'direct') Object.assign(m, { mid: m.mid * 0.96, tempo: m.tempo * 1.15, shotQuality: m.shotQuality * 0.93 });

  // Largeur.
  if (i.width === 'wide') Object.assign(m, { att: m.att * 1.03, tempo: m.tempo * 1.04, def: m.def * 0.98 });
  if (i.width === 'narrow') Object.assign(m, { att: m.att * 0.98, def: m.def * 1.03 });

  // Engagement : rugueux freine l'adversaire mais coûte des cartons.
  if (i.tackling === 'hard') Object.assign(m, { concede: m.concede * 0.96, fouls: m.fouls * 1.6, redRisk: m.redRisk * 2 });
  if (i.tackling === 'cautious') Object.assign(m, { concede: m.concede * 1.04, fouls: m.fouls * 0.6, redRisk: m.redRisk * 0.5 });

  // Gagner du temps : seulement quand on mène.
  if (i.timeWasting && leading) Object.assign(m, { tempo: m.tempo * 0.8, fouls: m.fouls * 1.15 });

  // Rythme.
  if (i.tempo === 'fast') Object.assign(m, { tempo: m.tempo * 1.1, shotQuality: m.shotQuality * 0.97, drain: m.drain + 0.06 });
  if (i.tempo === 'slow') Object.assign(m, { tempo: m.tempo * 0.88, mid: m.mid * 1.02, drain: m.drain - 0.03 });

  // Couloir d'attaque : les ailes contre un bloc étroit, l'axe contre une équipe étirée.
  if (i.focus === 'flanks') m.att *= opponent?.width === 'narrow' ? 1.05 : 1.01;
  if (i.focus === 'center') m.shotQuality *= opponent?.width === 'wide' ? 1.06 : opponent?.line === 'deep' ? 0.97 : 1.01;

  // Marquage individuel : efficace contre le jeu direct, usant, plus de fautes.
  if (i.marking === 'man') Object.assign(m, { def: m.def * (opponent?.passing === 'direct' ? 1.04 : 1.01), fouls: m.fouls * 1.1, drain: m.drain + 0.05 });

  // Choix de tir.
  if (i.shooting === 'patient') Object.assign(m, { tempo: m.tempo * 0.94, shotQuality: m.shotQuality * 1.06 });
  if (i.shooting === 'long') Object.assign(m, { tempo: m.tempo * 1.07, shotQuality: m.shotQuality * 0.9 });

  // Coups de pied arrêtés.
  if (i.setPieces === 'aerial') Object.assign(m, { shotQuality: m.shotQuality * 1.02, tempo: m.tempo * 0.98 });
  if (i.setPieces === 'short') m.mid *= 1.01;

  // Relance du gardien : courte = possession, mais dangereuse face à un pressing haut.
  if (i.distribution === 'short') Object.assign(m, { mid: m.mid * 1.03, concede: m.concede * (opponent?.pressing === 'high' ? 1.06 : 1) });
  if (i.distribution === 'long') Object.assign(m, { mid: m.mid * 0.98, tempo: m.tempo * 1.03 });

  // Piège du hors-jeu : rentable avec une ligne haute, sanctionné par le jeu direct et les contres.
  if (i.offsideTrap && i.line !== 'deep') m.concede *= opponent?.passing === 'direct' || opponent?.counter ? 1.1 : 0.93;

  // Une ligne haute adverse offre des espaces aux équipes qui jouent en contre.
  if (i.counter && opponent?.line === 'high') m.shotQuality *= 1.06;
  return m;
}

export type GamePlanId = 'control' | 'press' | 'push' | 'allOut' | 'killGame' | 'counterBlock' | 'compact' | 'siege' | 'calm' | 'possession' | 'longBall' | 'highTrap' | 'wingPlay';

export interface GamePlan {
  id: GamePlanId;
  label: string;
  description: string;
  style: TeamStyle;
  instructions: TeamInstructions;
}

const plan = (id: GamePlanId, label: string, description: string, style: TeamStyle, changes: Partial<TeamInstructions>): GamePlan => ({
  id,
  label,
  description,
  style,
  instructions: { ...DEFAULT_INSTRUCTIONS, ...changes },
});

/** Plans de jeu prêts à l'emploi, adaptés aux scénarios de match. */
export const GAME_PLANS: Record<GamePlanId, GamePlan> = {
  control: plan('control', 'Contrôler le match', 'Possession, passes courtes, aucun risque inutile.', 'balanced', { passing: 'short', distribution: 'short' }),
  possession: plan('possession', 'Confisquer le ballon', 'Rythme lent, passes courtes, on attend l’occasion nette.', 'balanced', { passing: 'short', tempo: 'slow', shooting: 'patient', distribution: 'short' }),
  press: plan('press', 'Pressing intense', 'Étouffer l’adversaire très haut. Efficace mais épuisant.', 'attacking', { pressing: 'high', line: 'high', passing: 'short', tempo: 'fast' }),
  highTrap: plan('highTrap', 'Ligne haute et hors-jeu', 'Bloc très haut et piège du hors-jeu contre une équipe qui construit court.', 'balanced', { pressing: 'high', line: 'high', offsideTrap: true, marking: 'zonal' }),
  wingPlay: plan('wingPlay', 'Jeu sur les ailes', 'Écarter le jeu et centrer, idéal contre un bloc axial.', 'attacking', { width: 'wide', focus: 'flanks', setPieces: 'aerial' }),
  push: plan('push', 'Pousser pour revenir', 'Plus de monde devant, jeu sur les ailes.', 'attacking', { pressing: 'high', width: 'wide', tempo: 'fast', focus: 'flanks' }),
  allOut: plan('allOut', 'Tout pour l’attaque', 'Dernières minutes : ballons directs, ligne haute, tout le monde devant.', 'ultraAttacking', { pressing: 'high', line: 'high', passing: 'direct', width: 'wide', tempo: 'fast', shooting: 'long', setPieces: 'aerial', distribution: 'long' }),
  longBall: plan('longBall', 'Jeu long', 'Sauter le milieu : relances longues et duels aériens.', 'balanced', { passing: 'direct', distribution: 'long', setPieces: 'aerial', tempo: 'fast' }),
  killGame: plan('killGame', 'Fermer le match', 'Bloc bas, ballon gardé, gagner du temps.', 'defensive', { pressing: 'low', line: 'deep', passing: 'short', width: 'narrow', tempo: 'slow', shooting: 'patient', timeWasting: true }),
  counterBlock: plan('counterBlock', 'Bloc bas et contres', 'Laisser venir un adversaire plus fort et le punir en contre.', 'defensive', { pressing: 'low', line: 'deep', passing: 'direct', counter: true, distribution: 'long', focus: 'flanks' }),
  compact: plan('compact', 'Rester compact à dix', 'Resserrer les lignes et limiter les efforts.', 'defensive', { pressing: 'low', line: 'deep', width: 'narrow', tackling: 'cautious', tempo: 'slow' }),
  siege: plan('siege', 'Faire le siège', 'L’adversaire est à dix : l’asphyxier par la largeur.', 'attacking', { pressing: 'high', line: 'high', passing: 'short', width: 'wide', focus: 'flanks', setPieces: 'aerial' }),
  calm: plan('calm', 'Calmer les ardeurs', 'Trop de cartons : engagement prudent pour finir à onze.', 'balanced', { tackling: 'cautious', pressing: 'medium', marking: 'zonal' }),
};

export interface Scenario {
  minute: number;
  diff: number;
  ownReds: number;
  oppReds: number;
  ownYellows: number;
  energy: number;
  /** Rapport de forces (>1 : l'équipe est plus forte). */
  balance: number;
  /** Consignes de l'adversaire (pour proposer la parade). */
  opponent?: TeamInstructions;
}

/** Situation résumée en une phrase pour l'entraîneur. */
export function describeScenario(sc: Scenario): string {
  const score = sc.diff > 0 ? `Vous menez de ${sc.diff} but${sc.diff > 1 ? 's' : ''}` : sc.diff < 0 ? `Vous êtes menés de ${-sc.diff} but${sc.diff < -1 ? 's' : ''}` : 'Score de parité';
  const phase = sc.minute < 30 ? 'en début de match' : sc.minute < 60 ? 'à l’heure de jeu' : sc.minute < 80 ? 'dans le dernier quart d’heure' : 'dans les dernières minutes';
  const extras: string[] = [];
  if (sc.ownReds > sc.oppReds) extras.push('vous jouez en infériorité numérique');
  if (sc.oppReds > sc.ownReds) extras.push('l’adversaire est réduit');
  if (sc.energy < 55) extras.push('vos joueurs fatiguent');
  if (sc.ownYellows >= 3) extras.push(`${sc.ownYellows} avertis`);
  return `${score} ${phase}${extras.length ? ' — ' + extras.join(', ') : ''}.`;
}

/** Plans conseillés selon le scénario, du plus pertinent au moins pertinent. */
export function recommendPlans(sc: Scenario): GamePlanId[] {
  const out: GamePlanId[] = [];
  if (sc.ownReds > sc.oppReds) out.push(sc.diff >= 0 ? 'compact' : 'counterBlock');
  if (sc.oppReds > sc.ownReds) out.push('siege');
  if (sc.diff < 0) out.push(sc.minute >= 75 ? 'allOut' : 'push');
  if (sc.diff > 0 && sc.minute >= 65) out.push('killGame');
  if (sc.diff > 0 && sc.minute < 65) out.push(sc.balance < 1 ? 'counterBlock' : 'control');
  if (sc.diff === 0) out.push(sc.balance < 0.95 ? 'counterBlock' : sc.minute < 30 && sc.energy > 80 ? 'press' : 'control');
  if (sc.ownYellows >= 3) out.push('calm');
  if (sc.energy < 50 && !out.includes('control')) out.push('possession');
  // Parades aux consignes adverses.
  const o = sc.opponent;
  if (o && sc.diff <= 0) {
    if (o.width === 'narrow') out.push('wingPlay');
    if (o.pressing === 'high') out.push('longBall');
    if (o.passing === 'short' && sc.balance >= 1 && sc.ownReds <= sc.oppReds) out.push('highTrap');
  }
  return [...new Set(out)].slice(0, 4);
}
