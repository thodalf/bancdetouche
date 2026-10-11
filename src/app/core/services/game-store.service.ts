import { computed, Injectable, signal } from '@angular/core';
import { Rng } from '../engine/rng';
import { isSeasonOver } from '../engine/season';
import { computeStandings } from '../engine/standings';
import { CUP_NAMES, leagueDef } from '../data/leagues.data';
import { wageBill } from '../engine/finance';
import { checkSquadRules } from '../engine/rules';
import { knowledgeOf, potentialEstimate, PotentialEstimate, ratingView, RatingView } from '../engine/scouting';
import { IdGen, idGenFor } from '../engine/world';
import { Club, Fixture, GameState, Player } from '../models';

/**
 * Source de vérité unique de la partie, exposée sous forme de signaux.
 * Toutes les modifications passent par `mutate`, qui travaille sur une copie
 * (mise à jour immuable) puis publie le nouvel état : chaque `computed` qui en dépend se recalcule.
 */
@Injectable({ providedIn: 'root' })
export class GameStore {
  private readonly _state = signal<GameState | null>(null);

  readonly state = this._state.asReadonly();
  readonly hasGame = computed(() => this._state() !== null);

  readonly clubsById = computed(() => new Map<string, Club>((this._state()?.clubs ?? []).map((c) => [c.id, c])));
  readonly playersById = computed(() => new Map<string, Player>((this._state()?.players ?? []).map((p) => [p.id, p])));

  readonly userClub = computed(() => {
    const s = this._state();
    return s ? this.clubsById().get(s.userClubId)! : null;
  });

  readonly userSquad = computed(() => {
    const s = this._state();
    return s ? s.players.filter((p) => p.clubId === s.userClubId && !p.youth) : [];
  });

  /** Jeunes du centre de formation. */
  readonly userYouth = computed(() => {
    const s = this._state();
    return s ? s.players.filter((p) => p.clubId === s.userClubId && p.youth) : [];
  });

  /** Conformité aux règles de composition (quotas, extracommunautaires). */
  readonly ruleChecks = computed(() => {
    const club = this.userClub();
    return club ? checkSquadRules(club, this.userSquad()) : [];
  });
  readonly ruleViolations = computed(() => this.ruleChecks().filter((r) => !r.ok));

  readonly unemployed = computed(() => this._state()?.manager.unemployed ?? false);
  readonly pendingJobOffers = computed(() => (this._state()?.jobOffers ?? []).filter((o) => o.status === 'pending'));

  readonly userWageBill = computed(() => wageBill(this.userSquad()));

  /** Championnat du club de l'entraîneur. */
  readonly userLeague = computed(() => leagueDef(this.userClub()?.leagueId));
  /** Coupe nationale du club de l'entraîneur. */
  readonly userCupName = computed(() => CUP_NAMES[this.userLeague().country] ?? 'Coupe nationale');

  /** Classement du championnat de l'entraîneur. */
  readonly standings = computed(() => this.standingsFor(this.userLeague().id));

  /** Classement d'un championnat (recalculé à partir des résultats). */
  standingsFor(leagueId: string) {
    const s = this._state();
    if (!s) return [];
    const clubs = this.clubsById();
    const ids = s.clubs.filter((c) => (c.leagueId ?? 'fr1') === leagueId).map((c) => c.id);
    return computeStandings(ids, s.fixtures, (id) => clubs.get(id)?.name ?? id);
  }

  readonly userPosition = computed(() => {
    const s = this._state();
    return s ? this.standings().findIndex((r) => r.clubId === s.userClubId) + 1 : 0;
  });

  readonly seasonOver = computed(() => {
    const s = this._state();
    return s ? isSeasonOver(s) : false;
  });

  readonly currentWeek = computed(() => {
    const s = this._state();
    return s ? (s.weeks[s.currentWeek] ?? null) : null;
  });

  /** Match de l'utilisateur prévu cette semaine (s'il n'est pas encore joué). */
  readonly userFixtureThisWeek = computed<Fixture | null>(() => {
    const s = this._state();
    if (!s || this.seasonOver()) return null;
    return s.fixtures.find((f) => f.week === s.currentWeek && !f.played && (f.homeId === s.userClubId || f.awayId === s.userClubId)) ?? null;
  });

  readonly nextUserFixture = computed<Fixture | null>(() => {
    const s = this._state();
    if (!s) return null;
    return (
      s.fixtures
        .filter((f) => !f.played && f.week >= s.currentWeek && (f.homeId === s.userClubId || f.awayId === s.userClubId))
        .sort((a, b) => a.week - b.week)[0] ?? null
    );
  });

  readonly userFixtures = computed(() => {
    const s = this._state();
    if (!s) return [];
    return s.fixtures.filter((f) => f.homeId === s.userClubId || f.awayId === s.userClubId).sort((a, b) => a.week - b.week);
  });

  readonly pendingOffers = computed(() => (this._state()?.offers ?? []).filter((o) => o.status === 'pending'));
  readonly unreadNews = computed(() => (this._state()?.news ?? []).filter((n) => !n.read).length);

  /** Note telle que la voit l'entraîneur (brouillard de guerre pour les joueurs mal connus). */
  ratingViewOf(p: Player): RatingView {
    const s = this._state();
    return ratingView(p, s ? knowledgeOf(s, p) : 0);
  }

  /** Potentiel selon les recruteurs (null si le joueur est trop mal connu). */
  potentialOf(p: Player): PotentialEstimate | null {
    const s = this._state();
    return s ? potentialEstimate(s, p) : null;
  }

  knowledge(p: Player): number {
    const s = this._state();
    return s ? knowledgeOf(s, p) : 0;
  }

  load(state: GameState): void {
    this._state.set(state);
  }

  clear(): void {
    this._state.set(null);
  }

  /**
   * Applique une modification sur une copie de l'état. Le générateur aléatoire et le
   * compteur d'identifiants sont fournis et leur avancement est sauvegardé.
   */
  mutate<R>(fn: (draft: GameState, rng: Rng, ids: IdGen) => R): R {
    const current = this._state();
    if (!current) throw new Error('Aucune partie en cours');
    const draft = structuredClone(current);
    const rng = new Rng(draft.rngSeed);
    const result = fn(draft, rng, idGenFor(draft));
    draft.rngSeed = rng.state;
    this._state.set(draft);
    return result;
  }
}
