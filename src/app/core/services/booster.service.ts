import { computed, inject, Injectable } from '@angular/core';
import { BOOSTERS, claimCard, discardPack, missionCost, missionScore, openBooster, rarityOf, startMission, tierForScore, xpToNext } from '../engine/boosters';
import { fx } from '../engine/characters';
import { MissionFocus } from '../models';
import { GameStore } from './game-store.service';
import { ToastService } from './toast.service';

/** Niveau d'entraîneur, missions des recruteurs et ouverture des boosters qu'ils rapportent. */
@Injectable({ providedIn: 'root' })
export class BoosterService {
  private readonly store = inject(GameStore);
  private readonly toast = inject(ToastService);

  readonly level = computed(() => this.store.state()?.manager.level ?? 1);
  readonly xp = computed(() => this.store.state()?.manager.xp ?? 0);
  readonly xpNeeded = computed(() => xpToNext(this.level()));
  readonly perkPoints = computed(() => this.store.state()?.manager.perkPoints ?? 0);
  readonly items = computed(() => this.store.state()?.boosters.items ?? []);
  readonly pending = computed(() => this.store.state()?.pendingPack ?? null);
  readonly opened = computed(() => this.store.state()?.boosters.opened ?? 0);
  readonly specs = BOOSTERS;

  /** Recruteurs du club avec leur mission éventuelle. */
  readonly scouts = computed(() => {
    const s = this.store.state();
    if (!s) return [];
    return s.staff
      .filter((m) => m.role === 'scout')
      .map((m) => ({ scout: m, mission: s.missions.find((x) => x.id === m.missionId) ?? null }));
  });

  readonly rarityOf = rarityOf;

  /** Coût et qualité attendue d'une mission (sans l'aléa du terrain). */
  preview(staffId: string, weeks: number) {
    const s = this.store.state();
    const scout = s?.staff.find((m) => m.id === staffId);
    if (!s || !scout) return null;
    const score = missionScore(s, scout.skill, weeks, fx(s, 'boosterQuality'));
    const cost = missionCost(scout.skill, weeks);
    return {
      cost,
      affordable: (this.store.userClub()?.balance ?? 0) >= cost,
      tier: tierForScore(score),
      low: tierForScore(score - 3),
      high: tierForScore(score + 3),
      weeks: Math.max(1, weeks - (scout.traits.includes('globetrotter') ? 1 : 0)),
    };
  }

  start(staffId: string, focus: MissionFocus, weeks: number): boolean {
    return this.run((s, _rng, ids) => startMission(s, staffId, focus, weeks, ids), true);
  }

  open(itemId: string): boolean {
    return this.run((s, rng, ids) => openBooster(s, itemId, rng, ids));
  }

  claim(cardId: string): boolean {
    return this.run((s, _rng, ids) => claimCard(s, cardId, ids), true);
  }

  discard(): void {
    this.store.mutate((s) => discardPack(s));
    this.toast.show('Aucun joueur signé : leurs fiches restent consultables dans Transferts.');
  }

  private run(fn: Parameters<GameStore['mutate']>[0], toastSuccess = false): boolean {
    const res = this.store.mutate(fn) as { ok: boolean; message: string };
    if (!res.ok || toastSuccess) this.toast.show(res.message, res.ok ? 'success' : 'error');
    return res.ok;
  }
}
