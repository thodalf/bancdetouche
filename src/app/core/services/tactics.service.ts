import { computed, inject, Injectable } from '@angular/core';
import { autoPickLineup, teamStrength } from '../engine/lineup';
import { clubById, squadOf } from '../engine/world';
import { GAME_PLANS, GamePlanId, tacticalMods } from '../engine/game-plans';
import { DEFAULT_INSTRUCTIONS, FormationId, FORMATIONS, roleForPosition, ScenarioTrigger, TeamInstructions, TeamStyle, tacticSlots } from '../models';
import { GameStore } from './game-store.service';

/** Gestion de la composition et de la tactique du club de l'utilisateur. */
@Injectable({ providedIn: 'root' })
export class TacticsService {
  private readonly store = inject(GameStore);

  readonly tactic = computed(() => this.store.userClub()?.tactic ?? null);
  readonly strength = computed(() => {
    const t = this.tactic();
    return t ? teamStrength(t, this.store.userSquad()) : null;
  });

  setFormation(formation: FormationId): void {
    this.store.mutate((s) => {
      const club = clubById(s, s.userClubId);
      const previous = club.tactic.lineup.filter((x): x is string => !!x);
      club.tactic.formation = formation;
      club.tactic.slots = undefined;
      // On repart du meilleur onze pour la nouvelle formation, en gardant les titulaires si possible.
      const squad = squadOf(s, s.userClubId);
      const preferred = squad.filter((p) => previous.includes(p.id));
      const lineup = autoPickLineup(preferred.length >= 11 ? preferred : squad, formation);
      club.tactic.lineup = lineup.length === FORMATIONS[formation].slots.length ? lineup : autoPickLineup(squad, formation);
    });
  }

  setStyle(style: TeamStyle): void {
    this.store.mutate((s) => (clubById(s, s.userClubId).tactic.style = style));
  }

  /** Consignes complètes (anciennes sauvegardes : valeurs par défaut pour les nouvelles consignes). */
  readonly instructions = computed<TeamInstructions>(() => ({ ...DEFAULT_INSTRUCTIONS, ...(this.tactic()?.instructions ?? {}) }));

  /**
   * Profil tactique lu par le moteur (face à un adversaire neutre), ramené sur 0-100 (50 = neutre).
   */
  readonly profile = computed(() => {
    const t = this.tactic();
    if (!t) return [];
    const m = tacticalMods(t.style, this.instructions(), false, DEFAULT_INSTRUCTIONS);
    const scale = (v: number, spread: number) => Math.round(Math.min(100, Math.max(0, 50 + (v - 1) * spread)));
    return [
      { id: 'attack', label: 'Danger offensif', value: scale(m.att * m.shotQuality, 260), hint: 'Force et qualité des occasions' },
      { id: 'defense', label: 'Solidité', value: scale(m.def / m.concede, 260), hint: 'Résistance aux attaques adverses' },
      { id: 'control', label: 'Maîtrise du milieu', value: scale(m.mid, 400), hint: 'Possession et récupération' },
      { id: 'tempo', label: 'Rythme', value: scale(m.tempo, 120), hint: 'Nombre d’attaques par match' },
      { id: 'stamina', label: 'Dépense physique', value: Math.round(Math.min(100, Math.max(0, 40 + m.drain * 160))), hint: 'Usure de l’endurance en match', inverted: true },
      { id: 'discipline', label: 'Risque de cartons', value: scale(m.fouls * Math.sqrt(m.redRisk), 60), hint: 'Fautes et expulsions', inverted: true },
    ];
  });

  setInstruction<K extends keyof TeamInstructions>(key: K, value: TeamInstructions[K]): void {
    this.store.mutate((s) => {
      const tactic = clubById(s, s.userClubId).tactic;
      tactic.instructions = { ...DEFAULT_INSTRUCTIONS, ...tactic.instructions, [key]: value };
    });
  }

  /** Applique un plan de jeu prédéfini (mentalité + consignes) à la tactique du club. */
  applyPlan(id: GamePlanId): void {
    const p = GAME_PLANS[id];
    this.store.mutate((s) => {
      const tactic = clubById(s, s.userClubId).tactic;
      tactic.style = p.style;
      tactic.instructions = { ...DEFAULT_INSTRUCTIONS, ...p.instructions };
    });
  }

  resetInstructions(): void {
    this.store.mutate((s) => (clubById(s, s.userClubId).tactic.instructions = { ...DEFAULT_INSTRUCTIONS }));
  }

  /** Consigne conditionnelle : plan appliqué automatiquement en match dans un scénario donné. */
  setScenario(trigger: ScenarioTrigger, plan: GamePlanId | null, from: number): void {
    this.store.mutate((s) => {
      const tactic = clubById(s, s.userClubId).tactic;
      const rules = { ...(tactic.scenarios ?? {}) };
      if (plan) rules[trigger] = { plan, from };
      else delete rules[trigger];
      tactic.scenarios = rules;
    });
  }

  /**
   * Déplace un poste sur le terrain (glisser-déposer). Le poste est recalculé d'après la zone ;
   * le gardien reste dans sa surface.
   */
  moveSlot(index: number, x: number, y: number): void {
    this.store.mutate((s) => {
      const tactic = clubById(s, s.userClubId).tactic;
      const slots = tacticSlots(tactic).map((sl) => ({ ...sl }));
      const slot = slots[index];
      if (!slot) return;
      const cx = Math.round(Math.min(94, Math.max(6, x)));
      if (slot.role === 'GK') {
        slot.x = Math.min(70, Math.max(30, cx));
        slot.y = Math.round(Math.min(95, Math.max(84, y)));
      } else {
        slot.x = cx;
        slot.y = Math.round(Math.min(82, Math.max(8, y)));
        slot.role = roleForPosition(slot.x, slot.y);
      }
      tactic.slots = slots;
    });
  }

  resetPositions(): void {
    this.store.mutate((s) => (clubById(s, s.userClubId).tactic.slots = undefined));
  }

  autoPick(): void {
    this.store.mutate((s) => {
      const club = clubById(s, s.userClubId);
      club.tactic.lineup = autoPickLineup(squadOf(s, s.userClubId), tacticSlots(club.tactic));
    });
  }

  /** Place un joueur sur un poste ; s'il était déjà titulaire ailleurs, les deux joueurs échangent. */
  assign(slotIndex: number, playerId: string): void {
    this.store.mutate((s) => {
      const lineup = clubById(s, s.userClubId).tactic.lineup;
      const previousSlot = lineup.indexOf(playerId);
      const displaced = lineup[slotIndex];
      lineup[slotIndex] = playerId;
      if (previousSlot >= 0 && previousSlot !== slotIndex) lineup[previousSlot] = displaced ?? null;
    });
  }

  clearSlot(slotIndex: number): void {
    this.store.mutate((s) => (clubById(s, s.userClubId).tactic.lineup[slotIndex] = null));
  }
}
