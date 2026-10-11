import { ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, signal, viewChild } from '@angular/core';
import { effectiveRating, positionFit } from '../../core/engine/lineup';
import { GAME_PLANS, GamePlanId } from '../../core/engine/game-plans';
import { PlayerCardService } from '../../core/services/player-card.service';
import {
  DEFAULT_INSTRUCTIONS,
  FORMATION_IDS,
  INSTRUCTION_GROUPS,
  INSTRUCTION_HINTS,
  INSTRUCTION_LABELS,
  INSTRUCTION_OPTIONS,
  SCENARIO_TRIGGERS,
  ScenarioTrigger,
  isNonEu,
  Player,
  POSITION_GROUP,
  POSITION_LABELS,
  POSITION_ORDER,
  STYLE_LABELS,
  STYLE_ORDER,
  tacticSlots,
  TeamInstructions,
} from '../../core/models';
import { GameStore } from '../../core/services/game-store.service';
import { TacticsService } from '../../core/services/tactics.service';
import { RouterLink } from '@angular/router';
import { MeterComponent, RatingComponent } from '../../shared/components/rating.component';
import { PlayerNamePipe, PositionPipe } from '../../shared/pipes/labels.pipe';

@Component({
  selector: 'app-tactics',
  imports: [RouterLink, RatingComponent, MeterComponent, PositionPipe, PlayerNamePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tactics.component.html',
  styleUrl: './tactics.component.scss',
})
export class TacticsComponent {
  protected readonly store = inject(GameStore);
  protected readonly tactics = inject(TacticsService);

  protected readonly formations = FORMATION_IDS;
  protected readonly styles = STYLE_ORDER.map((id) => [id, STYLE_LABELS[id]] as const);
  protected readonly styleLabels = STYLE_LABELS;
  protected readonly card = inject(PlayerCardService);
  protected readonly defaults = DEFAULT_INSTRUCTIONS;
  protected readonly plans = Object.values(GAME_PLANS);
  protected readonly minutes = [0, 30, 45, 55, 60, 65, 70, 75, 80, 85];

  protected readonly views = [
    { id: 'composition', label: 'Composition' },
    { id: 'consignes', label: 'Consignes' },
    { id: 'scenarios', label: 'Scénarios' },
  ] as const;
  protected readonly view = signal<'composition' | 'consignes' | 'scenarios'>('composition');

  /** Consignes regroupées par phase de jeu ; les interrupteurs deviennent des choix Non / Oui. */
  protected readonly groups = INSTRUCTION_GROUPS.map((g) => ({
    ...g,
    rows: g.keys.map((key) => ({
      key,
      label: INSTRUCTION_LABELS[key],
      options: (key in INSTRUCTION_OPTIONS
        ? INSTRUCTION_OPTIONS[key as keyof typeof INSTRUCTION_OPTIONS]
        : [
            [false, 'Non'],
            [true, 'Oui'],
          ]) as readonly (readonly [string | boolean, string])[],
    })),
  }));
  protected readonly instructions = this.tactics.instructions;

  protected hint(key: keyof TeamInstructions, value: unknown): string {
    return INSTRUCTION_HINTS[`${key}.${value}`] ?? '';
  }

  /** Plan prédéfini correspondant exactement aux réglages actuels. */
  protected readonly currentPlan = computed(() => {
    const t = this.tactics.tactic();
    if (!t) return null;
    const i = this.instructions();
    return (
      this.plans.find((p) => p.style === t.style && (Object.keys(p.instructions) as (keyof TeamInstructions)[]).every((k) => p.instructions[k] === i[k]))?.id ?? null
    );
  });

  protected readonly scenarioRows = computed(() => {
    const rules = this.tactics.tactic()?.scenarios ?? {};
    const defaultFrom: Record<ScenarioTrigger, number> = { downToTen: 0, upAgainstTen: 0, trailing: 70, leading: 75, drawing: 80, tired: 60 };
    return SCENARIO_TRIGGERS.map((tr) => {
      const rule = rules[tr.id] ?? null;
      return { ...tr, rule, defaultFrom: defaultFrom[tr.id], planDef: rule ? GAME_PLANS[rule.plan as GamePlanId] : null };
    });
  });
  protected readonly activeScenarios = computed(() => this.scenarioRows().filter((r) => !!r.rule).length);

  protected setScenarioPlan(trigger: ScenarioTrigger, plan: string, from: number): void {
    this.tactics.setScenario(trigger, (plan || null) as GamePlanId | null, from);
  }

  protected presetScenarios(kind: 'prudent' | 'ambitious' | 'none'): void {
    const presets: Record<typeof kind, Partial<Record<ScenarioTrigger, [GamePlanId, number]>>> = {
      prudent: { downToTen: ['compact', 0], upAgainstTen: ['siege', 0], trailing: ['push', 70], leading: ['killGame', 70], tired: ['possession', 65] },
      ambitious: { downToTen: ['counterBlock', 0], upAgainstTen: ['siege', 0], trailing: ['allOut', 75], leading: ['control', 80], drawing: ['push', 75] },
      none: {},
    };
    for (const tr of SCENARIO_TRIGGERS) {
      const p = presets[kind][tr.id];
      this.tactics.setScenario(tr.id, p ? p[0] : null, p ? p[1] : 0);
    }
  }

  // ------------------------------------------------------------------ glisser-déposer
  private readonly pitchRef = viewChild<ElementRef<HTMLElement>>('pitch');
  /** Élément en cours de déplacement : un poste du terrain ou un joueur de la liste. */
  protected readonly drag = signal<{ kind: 'slot' | 'player'; index?: number; playerId?: string; label: string; x: number; y: number; moved: boolean } | null>(null);
  protected readonly dropSlot = signal<number | null>(null);
  private suppressClick = false;
  private readonly destroyRef = inject(DestroyRef);
  protected readonly groupOf = POSITION_GROUP;

  /** Poste sélectionné sur le terrain (index dans la formation). */
  protected readonly selectedSlot = signal<number | null>(null);

  protected readonly slots = computed(() => {
    const tactic = this.tactics.tactic();
    if (!tactic) return [];
    const byId = this.store.playersById();
    return tacticSlots(tactic).map((slot, i) => {
      const id = tactic.lineup[i];
      const player = id ? (byId.get(id) ?? null) : null;
      const fit = player ? positionFit(player.position, slot.role) : 0;
      return { slot, index: i, player, fit, fitLevel: !player ? 'empty' : fit >= 1 ? 'good' : fit >= 0.85 ? 'ok' : 'bad' };
    });
  });

  protected readonly isNonEu = isNonEu;

  protected readonly problems = computed(() => {
    const list: string[] = this.store.ruleViolations().map((r) => `Règlement : ${r.label.toLowerCase()} ${r.value}/${r.limit}. ${r.fix}`);
    for (const s of this.slots()) {
      if (!s.player) list.push(`Poste ${POSITION_LABELS[s.slot.role]} vide : le meilleur remplaçant sera aligné automatiquement.`);
      else if (s.player.injuryWeeks > 0) list.push(`${s.player.lastName} est blessé et sera remplacé.`);
      else if (s.fitLevel === 'bad') list.push(`${s.player.lastName} joue hors de son poste naturel.`);
      else if (s.player.fatigue >= 60) list.push(`${s.player.lastName} est épuisé (condition ${100 - s.player.fatigue}) : risque de blessure accru.`);
      else if (s.player.morale < 30) list.push(`${s.player.lastName} a le moral au plus bas et rendra moins.`);
    }
    return list;
  });

  /** Effectif trié ; si un poste est sélectionné, par adaptation à ce poste. */
  protected readonly bench = computed(() => {
    const sel = this.selectedSlot();
    const lineup = this.tactics.tactic()?.lineup ?? [];
    const role = sel !== null ? this.slots()[sel]?.slot.role : null;
    return [...this.store.userSquad()]
      .map((p) => ({
        player: p,
        inLineup: lineup.includes(p.id),
        score: role ? Math.round(effectiveRating(p, role)) : null,
        fit: role ? positionFit(p.position, role) : null,
      }))
      .sort((a, b) =>
        role
          ? (b.score ?? 0) - (a.score ?? 0)
          : Number(b.inLineup) - Number(a.inLineup) || POSITION_ORDER.indexOf(a.player.position) - POSITION_ORDER.indexOf(b.player.position),
      );
  });

  protected readonly strengthBars = computed(() => {
    const s = this.tactics.strength();
    if (!s) return [];
    return [
      { label: 'Attaque', value: s.attack },
      { label: 'Milieu', value: s.midfield },
      { label: 'Défense', value: s.defense },
      { label: 'Gardien', value: s.goalkeeping },
    ].map((b) => ({ ...b, value: Math.round(b.value) }));
  });

  protected clickSlot(index: number): void {
    const current = this.selectedSlot();
    if (current === null) {
      this.selectedSlot.set(index);
      return;
    }
    if (current === index) {
      this.selectedSlot.set(null);
      return;
    }
    // Deux postes cliqués à la suite : on échange les joueurs.
    const moving = this.slots()[current].player;
    if (moving) this.tactics.assign(index, moving.id);
    this.selectedSlot.set(null);
  }

  protected pick(p: Player): void {
    const slot = this.selectedSlot();
    if (slot === null || p.injuryWeeks > 0) return;
    this.tactics.assign(slot, p.id);
    this.selectedSlot.set(null);
  }

  protected readonly positionNames: Record<string, string> = {
    GK: 'gardien', CB: 'défenseur central', LB: 'latéral gauche', RB: 'latéral droit', DM: 'milieu défensif', CM: 'milieu central',
    LM: 'milieu gauche', RM: 'milieu droit', AM: 'milieu offensif', LW: 'ailier gauche', RW: 'ailier droit', ST: 'avant-centre',
  };

  /** Clic sur un nom : ouvre la fiche (sauf s'il termine un glisser-déposer). */
  protected openCard(event: Event, p: Player): void {
    if (this.suppressClick) return;
    event.stopPropagation();
    this.card.open(p.id);
  }

  protected surname(p: Player): string {
    return p.lastName.length > 11 ? p.lastName.slice(0, 10) + '.' : p.lastName;
  }

  setInstruction(key: keyof TeamInstructions, value: string | boolean): void {
    this.tactics.setInstruction(key, value as never);
  }

  protected tokenClick(index: number): void {
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    this.clickSlot(index);
  }

  protected rowClick(p: Player): void {
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    this.pick(p);
  }

  /** Début d'un glisser : un poste du terrain ou un joueur de la liste. */
  protected startDrag(event: PointerEvent, kind: 'slot' | 'player', ref: number | Player): void {
    if (event.button !== 0) return;
    const label = typeof ref === 'number' ? (this.slots()[ref]?.player?.lastName ?? POSITION_LABELS[this.slots()[ref].slot.role]) : ref.lastName;
    if (typeof ref !== 'number' && ref.injuryWeeks > 0) return;
    const start = { x: event.clientX, y: event.clientY };
    this.drag.set({ kind, index: typeof ref === 'number' ? ref : undefined, playerId: typeof ref === 'number' ? undefined : ref.id, label, x: start.x, y: start.y, moved: false });

    const move = (e: PointerEvent) => {
      const d = this.drag();
      if (!d) return;
      const moved = d.moved || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6;
      if (moved) e.preventDefault();
      this.drag.set({ ...d, x: e.clientX, y: e.clientY, moved });
      this.dropSlot.set(moved ? this.slotAt(e.clientX, e.clientY) : null);
    };
    const up = (e: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const d = this.drag();
      this.drag.set(null);
      this.dropSlot.set(null);
      if (!d?.moved) return;
      this.suppressClick = true;
      setTimeout(() => (this.suppressClick = false), 0);
      this.drop(d, e.clientX, e.clientY);
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    this.destroyRef.onDestroy(() => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    });
  }

  private slotAt(x: number, y: number): number | null {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-slot]');
    return el ? Number(el.dataset['slot']) : null;
  }

  private drop(d: { kind: 'slot' | 'player'; index?: number; playerId?: string }, x: number, y: number): void {
    const target = this.slotAt(x, y);
    const slots = this.slots();
    if (d.kind === 'player' && d.playerId) {
      // Un joueur de la liste lâché sur un poste (ou près d'un poste) devient titulaire.
      const index = target ?? this.nearestSlot(x, y);
      if (index !== null) this.tactics.assign(index, d.playerId);
      this.selectedSlot.set(null);
      return;
    }
    if (d.index === undefined) return;
    if (target !== null && target !== d.index) {
      // Deux postes : on échange les joueurs.
      const moving = slots[d.index].player ?? slots[target].player;
      const dest = slots[d.index].player ? target : d.index;
      if (moving) this.tactics.assign(dest, moving.id);
      this.selectedSlot.set(null);
      return;
    }
    // Lâché sur une zone libre du terrain : le joueur change de position (et de poste).
    const rect = this.pitchRef()?.nativeElement.getBoundingClientRect();
    if (!rect || x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return;
    this.tactics.moveSlot(d.index, ((x - rect.left) / rect.width) * 100, ((y - rect.top) / rect.height) * 100);
  }

  private nearestSlot(x: number, y: number): number | null {
    const rect = this.pitchRef()?.nativeElement.getBoundingClientRect();
    if (!rect || x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null;
    const px = ((x - rect.left) / rect.width) * 100;
    const py = ((y - rect.top) / rect.height) * 100;
    let best: number | null = null;
    let dist = Infinity;
    this.slots().forEach((s) => {
      const dd = Math.hypot(s.slot.x - px, s.slot.y - py);
      if (dd < dist) {
        dist = dd;
        best = s.index;
      }
    });
    return best;
  }
}
