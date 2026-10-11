import { Club, GameState, hasTrait, Player, SESSION_INFO, SessionType, SQUAD_STATUS_ORDER, TALK_INFO, TalkApproach, WeekPlan } from '../models';
import { recentResults, streak } from './events';
import { teamStrength } from './lineup';
import { clamp } from './player-factory';
import { Rng } from './rng';
import { clubById, fullName, IdGen, squadOf, addNews } from './world';

/**
 * La semaine de l'entraîneur entre deux matchs : programme d'entraînement, préparation
 * du prochain adversaire, entretiens individuels et conférence de presse d'avant-match.
 */

export const DEFAULT_SESSIONS: SessionType[] = ['recovery', 'tactical', 'physical', 'technical', 'setPieces'];

/** Plan de la semaine en cours (sans l'enregistrer). */
export function weekPlan(s: GameState): WeekPlan {
  const p = s.weekPlan;
  if (p && p.season === s.season && p.week === s.currentWeek) return p;
  return { season: s.season, week: s.currentWeek, sessions: [...DEFAULT_SESSIONS], prep: null, talks: [], pressIds: pressQuestionIds(s), press: [null, null] };
}

/** Plan de la semaine, enregistré dans la partie (pour le modifier). */
export function ensureWeekPlan(s: GameState): WeekPlan {
  const p = weekPlan(s);
  s.weekPlan = p;
  p.press = p.pressIds.map((_, i) => p.press[i] ?? null);
  return p;
}

// ------------------------------------------------------------------ entraînement

export function setSession(s: GameState, day: number, type: SessionType): void {
  const p = ensureWeekPlan(s);
  if (day >= 0 && day < 5) p.sessions[day] = type;
}

const count = (p: WeekPlan, t: SessionType) => p.sessions.filter((x) => x === t).length;

/** Effet du programme de la semaine sur le match du week-end. */
export function trainingMatchEffect(p: WeekPlan): { strength: number; injury: number } {
  const strength = Math.min(3, count(p, 'tactical')) * 0.006 + count(p, 'physical') * 0.003 + Math.min(2, count(p, 'setPieces')) * 0.004;
  return { strength, injury: Math.max(0.6, 1 - count(p, 'physical') * 0.04) };
}

const FATIGUE: Record<SessionType, number> = { tactical: 2, physical: 5, technical: 3, setPieces: 1, recovery: -8, rest: -4 };

/** Bilan de la semaine d'entraînement (appelé en fin de semaine). */
export function applyTrainingWeek(s: GameState, rng: Rng, ids: IdGen): void {
  if (s.manager.unemployed) return;
  const p = weekPlan(s);
  const fatigue = p.sessions.reduce((acc, t) => acc + FATIGUE[t], 0);
  const squad = squadOf(s, s.userClubId);
  squad.forEach((pl) => (pl.fatigue = clamp(pl.fatigue + fatigue, 0, 100)));
  const technical = count(p, 'technical');
  const grown: string[] = [];
  for (const pl of squad) {
    if (pl.age > 23 || pl.rating >= pl.potential || pl.injuryWeeks > 0) continue;
    for (let i = 0; i < technical; i++) {
      if (rng.chance(0.05)) {
        pl.rating++;
        grown.push(fullName(pl));
        break;
      }
    }
  }
  const rest = count(p, 'rest');
  if (rest) {
    const club = clubById(s, s.userClubId);
    club.morale = clamp(club.morale + rest, 0, 100);
  }
  if (grown.length) addNews(s, 'youth', 'Les séances techniques paient', `${grown.join(', ')} progresse${grown.length > 1 ? 'nt' : ''} d'un point.`, ids);
  s.weekPlan = undefined;
}

// ------------------------------------------------------------------ préparation du match

export function userFixtureNow(s: GameState) {
  return s.fixtures.find((f) => f.week === s.currentWeek && !f.played && (f.homeId === s.userClubId || f.awayId === s.userClubId));
}

export interface OpponentReport {
  club: Club;
  home: boolean;
  strength: { attack: number; midfield: number; defense: number; goalkeeping: number; overall: number };
  ours: { attack: number; midfield: number; defense: number; goalkeeping: number; overall: number };
  keyPlayer: Player | null;
  form: ('W' | 'D' | 'L')[];
}

function formOf(s: GameState, clubId: string): ('W' | 'D' | 'L')[] {
  return s.fixtures
    .filter((f) => f.played && (f.homeId === clubId || f.awayId === clubId))
    .sort((a, b) => b.week - a.week)
    .slice(0, 5)
    .map((f) => {
      const [m, t] = f.homeId === clubId ? [f.homeGoals, f.awayGoals] : [f.awayGoals, f.homeGoals];
      return m > t ? 'W' : m < t ? 'L' : 'D';
    });
}

export function opponentReport(s: GameState): OpponentReport | null {
  const f = userFixtureNow(s);
  if (!f) return null;
  const oppId = f.homeId === s.userClubId ? f.awayId : f.homeId;
  const club = clubById(s, oppId);
  const squad = squadOf(s, oppId);
  const ownClub = clubById(s, s.userClubId);
  const lineup = new Set(club.tactic.lineup);
  const starters = squad.filter((p) => lineup.has(p.id));
  return {
    club,
    home: f.homeId === s.userClubId,
    strength: teamStrength(club.tactic, squad),
    ours: teamStrength(ownClub.tactic, squadOf(s, s.userClubId)),
    keyPlayer: [...(starters.length ? starters : squad)].sort((a, b) => b.rating - a.rating)[0] ?? null,
    form: formOf(s, oppId),
  };
}

export interface PrepOption {
  id: string;
  label: string;
  description: string;
  /** Pertinence 0-1 face à cet adversaire (cachée au joueur, estimée par l'adjoint). */
  fit: number;
}

export function prepOptions(s: GameState): PrepOption[] {
  const r = opponentReport(s);
  if (!r) return [];
  const st = r.strength;
  const lines = [st.attack, st.midfield, st.defense, st.goalkeeping];
  const max = Math.max(...lines);
  const min = Math.min(...lines);
  const span = Math.max(1, max - min);
  const strongFit = (v: number) => clamp((v - min) / span, 0, 1);
  const weakFit = (v: number) => clamp((max - v) / span, 0, 1);
  const ratio = st.overall / Math.max(1, r.ours.overall);
  const key = r.keyPlayer ? r.keyPlayer.lastName : 'leur meilleur joueur';
  return [
    { id: 'contain', label: `Neutraliser ${key}`, description: 'Marquage spécifique et couverture renforcée sur leur meilleur joueur.', fit: strongFit(st.attack) },
    { id: 'exploit', label: 'Attaquer leur défense', description: 'Séances d’attaque placée sur leurs faiblesses défensives.', fit: weakFit(st.defense) },
    { id: 'midfield', label: 'Gagner la bataille du milieu', description: 'Supériorité numérique et pressing sur leurs relayeurs.', fit: weakFit(st.midfield) },
    { id: 'keeper', label: 'Tester leur gardien', description: 'Frappes de loin et seconds ballons : leur dernier rempart est-il fiable ?', fit: weakFit(st.goalkeeping) },
    { id: 'lowBlock', label: 'Bloc bas et contres', description: 'Laisser venir un adversaire supérieur et le punir en transition.', fit: clamp((ratio - 0.97) * 8, 0, 1) },
  ];
}

/** Gain de force en match apporté par la préparation (0,5 % à 3 %). */
export const prepBoost = (fit: number) => 0.005 + fit * 0.025;

/** Ce que l'adjoint devine de la pertinence de chaque plan, selon sa compétence. */
export function prepAdvice(s: GameState, o: PrepOption): { stars: number | null; note: string } {
  const assistant = s.staff.find((m) => m.role === 'assistant');
  if (!assistant) return { stars: null, note: 'Sans adjoint, impossible d’évaluer ce plan.' };
  const noise = assistant.skill >= 15 ? 0 : assistant.skill >= 9 ? 0.25 : 0.5;
  // Bruit déterministe : même avis toute la semaine.
  let h = 0;
  for (const ch of `${o.id}${s.season}${s.currentWeek}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const guess = clamp(o.fit + ((h % 1000) / 1000 - 0.5) * 2 * noise, 0, 1);
  const stars = Math.round(guess * 4) + 1;
  return { stars, note: assistant.skill >= 15 ? 'Analyse fiable' : assistant.skill >= 9 ? 'Analyse approximative' : 'Analyse très incertaine' };
}

export function choosePrep(s: GameState, id: string): void {
  ensureWeekPlan(s).prep = id;
}

/** Effet total de la semaine sur le match de l'entraîneur (entraînement, préparation, presse). */
export function weekMatchEffect(s: GameState): { strength: number; injury: number } {
  const p = weekPlan(s);
  const training = trainingMatchEffect(p);
  let strength = training.strength;
  if (p.prep) {
    const o = prepOptions(s).find((x) => x.id === p.prep);
    if (o) strength += prepBoost(o.fit);
  }
  p.pressIds.forEach((qid, i) => {
    const a = p.press[i];
    if (a === null || a === undefined) return;
    strength += PRESS[qid]?.answers[a]?.boost ?? 0;
  });
  return { strength, injury: training.injury };
}

// ------------------------------------------------------------------ entretiens individuels

export function talkLimit(s: GameState): number {
  return 2 + (s.manager.lifestyle === 'mentor' || s.manager.lifestyle === 'leader' ? 1 : 0);
}

export function talkToPlayer(s: GameState, playerId: string, approach: TalkApproach): { ok: boolean; message: string } {
  const p = ensureWeekPlan(s);
  const pl = s.players.find((x) => x.id === playerId && x.clubId === s.userClubId);
  if (!pl) return { ok: false, message: 'Joueur introuvable.' };
  if (p.talks.length >= talkLimit(s)) return { ok: false, message: 'Plus de créneau d’entretien cette semaine.' };
  if (p.talks.some((t) => t.playerId === playerId)) return { ok: false, message: `Vous avez déjà parlé à ${fullName(pl)} cette semaine.` };
  let morale = 0;
  let form = 0;
  let text = '';
  switch (approach) {
    case 'praise':
      morale = pl.morale > 85 ? 1 : 5;
      if (hasTrait(pl, 'introvert')) {
        morale += 6;
        text = 'Il rougit, mais vos mots le touchent profondément.';
      } else if (pl.morale > 85) text = '« Merci coach, je sais. » Il est déjà au sommet.';
      else text = 'Il repart le sourire aux lèvres.';
      if (hasTrait(pl, 'professional')) form += 0.5;
      break;
    case 'demand':
      if (hasTrait(pl, 'temperamental')) {
        morale = -10;
        text = 'Il s’emporte : « Vous n’avez qu’à jouer à ma place ! »';
      } else if (hasTrait(pl, 'professional')) {
        morale = 2;
        form = 1.5;
        text = 'Il hoche la tête : il attendait ce genre d’exigence.';
      } else if (pl.morale < 40) {
        morale = -6;
        form = 0.5;
        text = 'Trop dur pour lui en ce moment : il se renferme.';
      } else {
        morale = hasTrait(pl, 'partygoer') ? -3 : -2;
        form = 1;
        text = 'Le message est reçu, il va hausser son niveau.';
      }
      break;
    case 'promise': {
      const idx = SQUAD_STATUS_ORDER.indexOf(pl.squadStatus);
      if (idx > 0) {
        pl.squadStatus = SQUAD_STATUS_ORDER[idx - 1];
        morale = 10 + (hasTrait(pl, 'ambitious') ? 4 : 0);
        text = 'Il attendait ces mots. Attention : il comptera désormais sur plus de temps de jeu.';
      } else {
        morale = 3;
        text = '« Je suis déjà titulaire indiscutable, non ? »';
      }
      break;
    }
    case 'support':
      morale = (pl.morale < 45 ? 12 : 4) + (hasTrait(pl, 'loyal') || hasTrait(pl, 'introvert') ? 4 : 0);
      text = pl.morale < 45 ? 'Il se confie longuement : ça lui fait un bien fou.' : 'Une discussion sympathique, sans plus.';
      break;
  }
  pl.morale = clamp(pl.morale + morale, 0, 100);
  pl.form = clamp(pl.form + form, 0, 10);
  p.talks.push({ playerId, approach, text, delta: morale });
  return { ok: true, message: `${TALK_INFO[approach].label} ${fullName(pl)} : ${text}` };
}

// ------------------------------------------------------------------ conférence de presse

interface PressAnswer {
  label: string;
  outcome: string;
  /** Effet immédiat. */
  apply: (s: GameState) => void;
  /** Effet sur la force en match de la semaine. */
  boost?: number;
}

interface PressQuestion {
  /** Question, selon le contexte. */
  text: (s: GameState) => string;
  available: (s: GameState) => boolean;
  answers: PressAnswer[];
}

const teamMorale = (s: GameState, d: number) => {
  const c = clubById(s, s.userClubId);
  c.morale = clamp(c.morale + d, 0, 100);
};
const board = (s: GameState, d: number) => (s.board.confidence = clamp(s.board.confidence + d, 0, 100));
const topScorer = (s: GameState) => [...squadOf(s, s.userClubId)].sort((a, b) => b.stats.goals - a.stats.goals || b.rating - a.rating)[0];
const oppName = (s: GameState) => opponentReport(s)?.club.name ?? 'votre adversaire';

export const PRESS: Record<string, PressQuestion> = {
  opponent: {
    available: (s) => !!userFixtureNow(s),
    text: (s) => `« ${oppName(s)} arrive avec de grandes ambitions. Comment abordez-vous ce match ? »`,
    answers: [
      { label: 'Avec beaucoup de respect', outcome: 'Moral +1, confiance de la direction +1.', apply: (s) => (teamMorale(s, 1), board(s, 1)) },
      { label: 'Nous sommes prêts à les battre', outcome: 'Moral +2, force en match +1 %.', apply: (s) => teamMorale(s, 2), boost: 0.01 },
      { label: 'Ils devraient nous craindre', outcome: 'Moral +3, force en match +1,5 %, confiance de la direction −3.', apply: (s) => (teamMorale(s, 3), board(s, -3)), boost: 0.015 },
    ],
  },
  winning: {
    available: (s) => streak(s, 'W') >= 2,
    text: (s) => `« ${streak(s, 'W')} victoires de suite. Peut-on parler de titre ? »`,
    answers: [
      { label: 'Match après match', outcome: 'Moral +2.', apply: (s) => teamMorale(s, 2) },
      { label: 'Nous visons le plus haut possible', outcome: 'Confiance de la direction +3, moral +1.', apply: (s) => (board(s, 3), teamMorale(s, 1)) },
      { label: 'Oui, le titre est l’objectif', outcome: 'Confiance de la direction +5, mais pression : force en match −1 %.', apply: (s) => board(s, 5), boost: -0.01 },
    ],
  },
  losing: {
    available: (s) => streak(s, 'L') >= 2,
    text: () => '« Deux défaites de suite… Votre équipe est-elle en crise ? »',
    answers: [
      { label: 'Je défends mes joueurs', outcome: 'Moral +4, confiance de la direction −2.', apply: (s) => (teamMorale(s, 4), board(s, -2)) },
      { label: 'J’assume, c’est ma responsabilité', outcome: 'Confiance de la direction +3.', apply: (s) => board(s, 3) },
      { label: 'L’arbitrage nous a coûté cher', outcome: 'Moral +1, confiance de la direction −1.', apply: (s) => (teamMorale(s, 1), board(s, -1)) },
    ],
  },
  scorer: {
    available: (s) => (topScorer(s)?.stats.goals ?? 0) >= 2,
    text: (s) => `« ${fullName(topScorer(s))} marque à chaque match. Est-il le meilleur joueur du championnat ? »`,
    answers: [
      { label: 'Sans aucun doute', outcome: 'Moral du joueur +8 (mais ses exigences pourraient grimper).', apply: (s) => { const p = topScorer(s); p.morale = clamp(p.morale + 8, 0, 100); } },
      { label: 'Il doit encore progresser', outcome: 'Forme du joueur +1, moral −3.', apply: (s) => { const p = topScorer(s); p.form = clamp(p.form + 1, 0, 10); p.morale = clamp(p.morale - 3, 0, 100); } },
      { label: 'C’est le collectif qui le fait briller', outcome: 'Moral de l’équipe +2.', apply: (s) => teamMorale(s, 2) },
    ],
  },
  form: {
    available: (s) => recentResults(s, 3).length >= 1,
    text: (s) => {
      const r = recentResults(s, 1)[0];
      return r === 'W' ? '« Belle victoire la semaine dernière. Qu’est-ce qui a fait la différence ? »' : r === 'L' ? '« La défaite de la semaine dernière a-t-elle laissé des traces ? »' : '« Un match nul la semaine dernière : satisfait ou frustré ? »';
    },
    answers: [
      { label: 'L’état d’esprit du groupe', outcome: 'Moral +3.', apply: (s) => teamMorale(s, 3) },
      { label: 'Le travail tactique de la semaine', outcome: 'Force en match +0,5 %, opinion de l’adjoint +3.', apply: (s) => { const a = s.staff.find((m) => m.role === 'assistant'); if (a) a.opinion = clamp(a.opinion + 3, 0, 100); }, boost: 0.005 },
      { label: 'Pas de commentaire', outcome: 'Confiance de la direction −1.', apply: (s) => board(s, -1) },
    ],
  },
  board: {
    available: () => true,
    text: (s) => `« Votre direction attend une place dans les ${s.board.objectives.find((o) => o.kind === 'league')?.target ?? 8} premiers. Réaliste ? »`,
    answers: [
      { label: 'C’est notre objectif', outcome: 'Confiance de la direction +2.', apply: (s) => board(s, 2) },
      { label: 'Nous pouvons viser plus haut', outcome: 'Confiance de la direction +4, force en match −0,5 % (pression).', apply: (s) => board(s, 4), boost: -0.005 },
      { label: 'Ce sera très difficile', outcome: 'Moral +2, confiance de la direction −3.', apply: (s) => (teamMorale(s, 2), board(s, -3)) },
    ],
  },
};

/** Deux questions tirées selon le contexte (stables pour la semaine). */
export function pressQuestionIds(s: GameState): string[] {
  const priority = ['losing', 'winning', 'opponent', 'scorer', 'form', 'board'];
  const avail = priority.filter((id) => PRESS[id].available(s));
  const first = avail[0];
  const rest = avail.filter((x) => x !== first);
  const second = rest[(s.currentWeek + s.season) % Math.max(1, rest.length)];
  return [first, second].filter((x): x is string => !!x);
}

export function answerPress(s: GameState, index: number, answer: number): { ok: boolean; message: string } {
  const p = ensureWeekPlan(s);
  const qid = p.pressIds[index];
  const q = qid ? PRESS[qid] : undefined;
  if (!q || !q.answers[answer]) return { ok: false, message: 'Question introuvable.' };
  if (p.press[index] !== null && p.press[index] !== undefined) return { ok: false, message: 'Vous avez déjà répondu.' };
  q.answers[answer].apply(s);
  p.press[index] = answer;
  return { ok: true, message: `« ${q.answers[answer].label}. »` };
}

/** Tâches de la semaine encore à faire (pour les rappels). */
export function weekTodo(s: GameState): number {
  const p = weekPlan(s);
  let n = 0;
  if (userFixtureNow(s) && !p.prep) n++;
  n += p.press.filter((x) => x === null || x === undefined).length;
  if (p.talks.length < talkLimit(s)) n++;
  return n;
}

export const sessionLabel = (t: SessionType) => SESSION_INFO[t].label;
