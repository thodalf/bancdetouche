import { computed, inject, Injectable } from '@angular/core';
import {
  EFFECT_INFO,
  effectSources,
  fireStaff,
  formatEffect,
  hireStaff,
  isGood,
  LIFESTYLES,
  ROLE_ORDER,
  selectLifestyle,
  staffEffects,
  staffRequiredReputation,
  totalEffects,
  TRAITS,
  unlockPerk,
} from '../engine/characters';
import { eventContext, eventDef, optionAvailable, resolveEvent } from '../engine/events';
import { EffectKey, Effects, LifestyleId, StaffMember } from '../models';
import { GameStore } from './game-store.service';
import { ToastService } from './toast.service';

export interface EffectLine {
  key: EffectKey;
  label: string;
  text: string;
  good: boolean;
}

export function effectLines(effects: Effects): EffectLine[] {
  return (Object.entries(effects) as [EffectKey, number][])
    .filter(([, v]) => Math.abs(v) > 1e-6)
    .map(([key, v]) => ({ key, label: EFFECT_INFO[key].label, text: formatEffect(key, v), good: isGood(key, v) }));
}

/** Staff (personnages), mode de vie de l'entraîneur et événements à choix. */
@Injectable({ providedIn: 'root' })
export class StaffService {
  private readonly store = inject(GameStore);
  private readonly toast = inject(ToastService);

  readonly traits = TRAITS;
  readonly lifestyles = Object.values(LIFESTYLES);

  readonly staff = computed(() => {
    const s = this.store.state();
    if (!s) return [];
    return [...s.staff].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || b.skill - a.skill).map((m) => this.view(m));
  });

  readonly market = computed(() => {
    const s = this.store.state();
    if (!s) return [];
    const rep = s.manager.reputation;
    return [...s.staffMarket]
      .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || b.skill - a.skill)
      .map((m) => ({ ...this.view(m), required: staffRequiredReputation(m.skill), reachable: rep >= staffRequiredReputation(m.skill), fee: m.wage * 4 }));
  });

  readonly manager = computed(() => this.store.state()?.manager ?? null);
  readonly totals = computed(() => {
    const s = this.store.state();
    return s ? effectLines(totalEffects(s)) : [];
  });
  readonly sources = computed(() => {
    const s = this.store.state();
    return s ? effectSources(s).map((src) => ({ ...src, lines: effectLines(src.effects) })).filter((x) => x.lines.length) : [];
  });
  readonly modifiers = computed(() => (this.store.state()?.modifiers ?? []).map((m) => ({ ...m, lines: effectLines(m.effects) })));
  readonly wageBill = computed(() => (this.store.state()?.staff ?? []).reduce((a, m) => a + m.wage, 0));

  /** Événement en attente de décision (bloque l'avancée du temps). */
  readonly pendingEvent = computed(() => {
    const s = this.store.state();
    const e = s?.events[0];
    const def = e ? eventDef(e.defId) : undefined;
    if (!s || !e || !def) return null;
    const ctx = eventContext(s, e);
    return { id: e.id, title: def.title, urgent: !!def.urgent, text: def.text(ctx, s), staff: ctx.staff ?? null, staff2: ctx.staff2 ?? null, player: ctx.player ?? null, player2: ctx.player2 ?? null, followUp: !!def.followUp, club: ctx.club ?? null, options: def.options.map((o) => ({ label: o.label, outcome: o.outcome, requirement: o.requires?.label ?? null, available: optionAvailable(s, ctx, o) })) };
  });

  readonly effectLinesOf = effectLines;

  private view(m: StaffMember) {
    return {
      member: m,
      name: `${m.firstName} ${m.lastName}`,
      traits: m.traits.map((t) => TRAITS[t]),
      lines: effectLines(staffEffects(m)),
    };
  }

  hire(id: string): boolean {
    return this.run((s, _r, ids) => hireStaff(s, id, ids));
  }

  fire(id: string): boolean {
    return this.run((s, _r, ids) => fireStaff(s, id, ids));
  }

  chooseLifestyle(id: LifestyleId): void {
    this.store.mutate((s) => selectLifestyle(s, id));
    this.toast.show(`Mode de vie : ${LIFESTYLES[id].label}.`, 'success');
  }

  unlock(perkId: string): boolean {
    return this.run((s) => unlockPerk(s, perkId));
  }

  resolve(eventId: string, option: number): void {
    const result = this.store.mutate((s, rng, ids) => resolveEvent(s, eventId, option, rng, ids)) as string;
    if (result) this.toast.show(result, 'success');
  }

  private run(fn: Parameters<GameStore['mutate']>[0]): boolean {
    const res = this.store.mutate(fn) as { ok: boolean; message: string };
    this.toast.show(res.message, res.ok ? 'success' : 'error');
    return res.ok;
  }
}
