import { computed, inject, Injectable } from '@angular/core';
import {
  answerPress,
  choosePrep,
  opponentReport,
  prepAdvice,
  prepBoost,
  prepOptions,
  PRESS,
  setSession,
  talkLimit,
  talkToPlayer,
  trainingMatchEffect,
  weekMatchEffect,
  weekPlan,
  weekTodo,
} from '../engine/week';
import { SessionType, TalkApproach } from '../models';
import { GameStore } from './game-store.service';
import { ToastService } from './toast.service';

/** Semaine de travail entre deux matchs. */
@Injectable({ providedIn: 'root' })
export class WeekService {
  private readonly store = inject(GameStore);
  private readonly toast = inject(ToastService);

  readonly plan = computed(() => {
    const s = this.store.state();
    return s ? weekPlan(s) : null;
  });
  readonly todo = computed(() => {
    const s = this.store.state();
    return s && !s.manager.unemployed ? weekTodo(s) : 0;
  });
  readonly report = computed(() => {
    const s = this.store.state();
    return s ? opponentReport(s) : null;
  });
  readonly prep = computed(() => {
    const s = this.store.state();
    if (!s) return [];
    return prepOptions(s).map((o) => ({ ...o, advice: prepAdvice(s, o), boostRange: [prepBoost(0), prepBoost(1)] }));
  });
  readonly training = computed(() => {
    const p = this.plan();
    if (!p) return null;
    const e = trainingMatchEffect(p);
    const fatigue = p.sessions.reduce((a, t) => a + ({ tactical: 2, physical: 5, technical: 3, setPieces: 1, recovery: -8, rest: -4 } as const)[t], 0);
    return { strength: e.strength, injury: e.injury, fatigue };
  });
  readonly matchEffect = computed(() => {
    const s = this.store.state();
    return s ? weekMatchEffect(s) : { strength: 0, injury: 1 };
  });
  readonly talkLimit = computed(() => {
    const s = this.store.state();
    return s ? talkLimit(s) : 2;
  });
  readonly press = computed(() => {
    const s = this.store.state();
    const p = this.plan();
    if (!s || !p) return [];
    return p.pressIds.map((id, i) => ({ index: i, text: PRESS[id].text(s), answers: PRESS[id].answers.map((a) => ({ label: a.label, outcome: a.outcome })), chosen: p.press[i] ?? null }));
  });

  setSession(day: number, type: SessionType): void {
    this.store.mutate((s) => setSession(s, day, type));
  }

  setProgram(sessions: SessionType[]): void {
    this.store.mutate((s) => sessions.forEach((t, i) => setSession(s, i, t)));
  }

  choosePrep(id: string): void {
    this.store.mutate((s) => choosePrep(s, id));
  }

  talk(playerId: string, approach: TalkApproach): void {
    const res = this.store.mutate((s) => talkToPlayer(s, playerId, approach));
    this.toast.show(res.message, res.ok ? 'success' : 'error');
  }

  answer(index: number, answer: number): void {
    const res = this.store.mutate((s) => answerPress(s, index, answer));
    if (!res.ok) this.toast.show(res.message, 'error');
  }
}
