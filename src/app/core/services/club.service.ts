import { computed, inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { intakeSize, promoteYouth, releaseYouth, YOUTH_INTAKE_WEEK } from '../engine/academy';
import { objectiveStatus, SACK_THRESHOLD } from '../engine/board';
import { acceptJob, declineJob, ClubIdentity, renameClub } from '../engine/career';
import { FACILITY_EFFECTS, facilitiesUpkeep, MAX_FACILITY_LEVEL, startUpgrade, upgradeCost } from '../engine/facilities';
import { TRAINING_EFFECTS } from '../engine/fitness';
import { clubById } from '../engine/world';
import { FACILITY_LABELS, FacilityKind, TrainingIntensity } from '../models';
import { GameStore } from './game-store.service';
import { ToastService } from './toast.service';

const KINDS: FacilityKind[] = ['stadium', 'training', 'academy', 'scouting'];

/** Infrastructures, entraînement, centre de formation, direction et carrière de l'entraîneur. */
@Injectable({ providedIn: 'root' })
export class ClubService {
  private readonly store = inject(GameStore);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  readonly trainingEffects = TRAINING_EFFECTS;
  readonly sackThreshold = SACK_THRESHOLD;

  readonly facilities = computed(() => {
    const club = this.store.userClub();
    if (!club) return [];
    return KINDS.map((kind) => {
      const level = club.facilities[kind];
      const next = level < MAX_FACILITY_LEVEL ? upgradeCost(kind, level + 1) : null;
      return {
        kind,
        label: FACILITY_LABELS[kind],
        level,
        effect: FACILITY_EFFECTS[kind](level),
        next,
        building: club.construction?.kind === kind ? club.construction : null,
      };
    });
  });

  readonly upkeep = computed(() => {
    const club = this.store.userClub();
    return club ? facilitiesUpkeep(club) : 0;
  });

  readonly objectives = computed(() => {
    const s = this.store.state();
    if (!s) return [];
    return s.board.objectives.map((o) => ({ objective: o, ...objectiveStatus(s, o) }));
  });

  readonly youthInfo = computed(() => {
    const s = this.store.state();
    const club = this.store.userClub();
    if (!s || !club) return null;
    const intakeWeek = s.weeks[YOUTH_INTAKE_WEEK];
    return {
      size: intakeSize(club.facilities.academy),
      intakeDate: intakeWeek?.date ?? null,
      intakeDone: s.currentWeek > YOUTH_INTAKE_WEEK,
    };
  });

  upgrade(kind: FacilityKind): void {
    const res = this.store.mutate((s, _rng, ids) => startUpgrade(s, kind, ids));
    this.toast.show(res.message, res.ok ? 'success' : 'error');
  }

  setTraining(intensity: TrainingIntensity): void {
    this.store.mutate((s) => (clubById(s, s.userClubId).trainingIntensity = intensity));
  }

  promote(playerId: string): void {
    const res = this.store.mutate((s, _rng, ids) => promoteYouth(s, playerId, ids));
    this.toast.show(res.message, res.ok ? 'success' : 'error');
  }

  releaseYouth(playerId: string): void {
    const res = this.store.mutate((s) => releaseYouth(s, playerId));
    this.toast.show(res.message, res.ok ? 'info' : 'error');
  }

  acceptJob(offerId: string): void {
    const res = this.store.mutate((s, _rng, ids) => acceptJob(s, offerId, ids));
    this.toast.show(res.message, res.ok ? 'success' : 'error');
    if (res.ok) this.router.navigate(['/jeu']);
  }

  rename(identity: ClubIdentity): boolean {
    const res = this.store.mutate((s, _rng, ids) => renameClub(s, identity, ids));
    this.toast.show(res.message, res.ok ? 'success' : 'error');
    return res.ok;
  }

  declineJob(offerId: string): void {
    this.store.mutate((s) => declineJob(s, offerId));
  }
}
