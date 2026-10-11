import { Club, isNonEu, Player } from '../models';
import { MAX_NON_EU_XI } from './lineup';

/**
 * Règles de composition d'équipe (inspirées des règlements des ligues européennes) :
 * - au plus 25 joueurs de plus de 21 ans dans l'effectif professionnel (les moins de 21 ans sont exemptés) ;
 * - au moins 4 joueurs formés au club dans l'effectif ;
 * - au plus 3 joueurs extracommunautaires dans le onze de départ.
 */
export const MAX_SENIOR_SQUAD = 25;
export const MIN_HOMEGROWN = 4;
export const U21_AGE = 21;
export { MAX_NON_EU_XI };

export interface RuleCheck {
  id: 'seniors' | 'homegrown' | 'nonEu';
  label: string;
  value: number;
  limit: number;
  ok: boolean;
  /** Explication actionnable en cas de non-conformité. */
  fix: string;
}

export const isHomegrown = (p: Player, clubId: string) => p.homegrownClubId === clubId;
export const isSenior = (p: Player) => p.age > U21_AGE;

export function checkSquadRules(club: Club, squad: Player[]): RuleCheck[] {
  const seniors = squad.filter(isSenior).length;
  const homegrown = squad.filter((p) => isHomegrown(p, club.id)).length;
  const byId = new Map(squad.map((p) => [p.id, p]));
  const nonEu = club.tactic.lineup.filter((id) => {
    const p = id ? byId.get(id) : undefined;
    return !!p && isNonEu(p);
  }).length;
  return [
    {
      id: 'seniors',
      label: `Joueurs de plus de ${U21_AGE} ans`,
      value: seniors,
      limit: MAX_SENIOR_SQUAD,
      ok: seniors <= MAX_SENIOR_SQUAD,
      fix: `Vendez, libérez ou cédez ${seniors - MAX_SENIOR_SQUAD} joueur(s) de plus de ${U21_AGE} ans.`,
    },
    {
      id: 'homegrown',
      label: 'Joueurs formés au club',
      value: homegrown,
      limit: MIN_HOMEGROWN,
      ok: homegrown >= MIN_HOMEGROWN,
      fix: `Promouvez ${MIN_HOMEGROWN - homegrown} jeune(s) du centre de formation en équipe première.`,
    },
    {
      id: 'nonEu',
      label: 'Extracommunautaires dans le onze',
      value: nonEu,
      limit: MAX_NON_EU_XI,
      ok: nonEu <= MAX_NON_EU_XI,
      fix: `Retirez ${nonEu - MAX_NON_EU_XI} joueur(s) extracommunautaire(s) du onze de départ.`,
    },
  ];
}

export const rulesViolations = (club: Club, squad: Player[]) => checkSquadRules(club, squad).filter((r) => !r.ok);
