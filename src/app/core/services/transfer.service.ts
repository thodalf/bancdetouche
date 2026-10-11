import { computed, inject, Injectable } from '@angular/core';
import { ContractDemands, demandsFor, negotiate, NegotiationResult, negotiationContext } from '../engine/contracts';
import { assignScout, maxAssignments, RatingView } from '../engine/scouting';
import { priceFor, respondToOffer, TransferOutcome, userBid, userRelease, wageDemand } from '../engine/transfers';
import { nowStamp, playerById } from '../engine/world';
import { ContractOffer, Player } from '../models';
import { GameStore } from './game-store.service';
import { ToastService } from './toast.service';

export interface MarketEntry {
  player: Player;
  price: number;
  wageDemand: number;
  clubName: string;
  view: RatingView;
  knowledge: number;
  scouting: boolean;
}

/** Marché des transferts, scouting et négociations du point de vue de l'utilisateur. */
@Injectable({ providedIn: 'root' })
export class TransferService {
  private readonly store = inject(GameStore);
  private readonly toast = inject(ToastService);

  /** Tous les joueurs recrutables, vus à travers le brouillard de guerre du scouting. */
  readonly market = computed<MarketEntry[]>(() => {
    const s = this.store.state();
    if (!s) return [];
    const clubs = this.store.clubsById();
    const assigned = new Set(s.scouting.assignments);
    return s.players
      .filter((p) => p.clubId !== s.userClubId && !p.youth)
      .map((p) => ({
        player: p,
        price: priceFor(s, p),
        wageDemand: wageDemand(p),
        clubName: p.clubId ? (clubs.get(p.clubId)?.name ?? '') : 'Libre',
        view: this.store.ratingViewOf(p),
        knowledge: this.store.knowledge(p),
        scouting: assigned.has(p.id),
      }));
  });

  readonly scoutSlots = computed(() => {
    const s = this.store.state();
    return s ? { used: s.scouting.assignments.length, max: maxAssignments(s) } : { used: 0, max: 0 };
  });

  /** Indemnités déjà acceptées par les clubs vendeurs, en attente de l'accord du joueur. */
  readonly agreements = computed(() => {
    const s = this.store.state();
    if (!s) return [];
    return s.feeAgreements
      .filter((a) => a.expires >= nowStamp(s))
      .map((a) => ({ ...a, player: this.store.playersById().get(a.playerId)! }))
      .filter((a) => !!a.player);
  });

  bid(playerId: string, amount: number): TransferOutcome {
    const outcome = this.store.mutate((s, rng) => userBid(s, playerId, amount, rng));
    this.toast.show(outcome.message, outcome.ok ? 'success' : 'error');
    return outcome;
  }

  /** Attentes du joueur pour un contrat avec le club de l'utilisateur. */
  demands(playerId: string): ContractDemands | null {
    const s = this.store.state();
    const p = s ? playerById(s, playerId) : undefined;
    return s && p ? demandsFor(s, p) : null;
  }

  context(playerId: string) {
    const s = this.store.state();
    const p = s ? playerById(s, playerId) : undefined;
    return s && p ? negotiationContext(s, p) : null;
  }

  roundsUsed(playerId: string): number {
    return this.store.state()?.negotiations[playerId] ?? 0;
  }

  negotiate(playerId: string, offer: ContractOffer): NegotiationResult {
    const result = this.store.mutate((s, _rng, ids) => negotiate(s, playerId, offer, ids));
    if (result.outcome === 'accepted') this.toast.show(result.message, 'success');
    if (result.outcome === 'walkout') this.toast.show(result.message, 'error');
    return result;
  }

  scout(playerId: string): void {
    const res = this.store.mutate((s) => assignScout(s, playerId));
    this.toast.show(res.message, res.ok ? 'success' : 'error');
  }

  release(playerId: string): TransferOutcome {
    return this.run((s, _rng, ids) => userRelease(s, playerId, ids));
  }

  respond(offerId: string, accept: boolean): TransferOutcome {
    return this.run((s, _rng, ids) => respondToOffer(s, offerId, accept, ids));
  }

  toggleListed(playerId: string): void {
    this.store.mutate((s) => {
      const p = s.players.find((x) => x.id === playerId && x.clubId === s.userClubId);
      if (p) p.transferListed = !p.transferListed;
    });
  }

  private run(fn: Parameters<GameStore['mutate']>[0]): TransferOutcome {
    const outcome = this.store.mutate(fn) as TransferOutcome;
    this.toast.show(outcome.message, outcome.ok ? 'success' : 'error');
    return outcome;
  }
}
