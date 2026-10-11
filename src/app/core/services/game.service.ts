import { effect, inject, Injectable, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { MatchResult } from '../engine/match-engine';
import { completeWeek, startNextSeason } from '../engine/season';
import { weekTodo } from '../engine/week';
import { createNewGame } from '../engine/new-game';
import { GameStore } from './game-store.service';
import { SaveService } from './save.service';
import { ToastService } from './toast.service';

const AUTOSAVE_KEY = 'banc-de-touche.autosave';

/** Façade des actions de haut niveau : cycle de vie de la partie et avancement du temps. */
@Injectable({ providedIn: 'root' })
export class GameService {
  private readonly store = inject(GameStore);
  private readonly saves = inject(SaveService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  readonly autosave = signal(readAutosavePref());
  /** Incrémenté à chaque demande de match, pour que l'écran de match se réinitialise s'il est déjà affiché. */
  readonly matchRequests = signal(0);

  constructor() {
    // Sauvegarde automatique à chaque changement d'état de la partie.
    effect(() => {
      const state = this.store.state();
      const enabled = this.autosave();
      if (state && enabled) untracked(() => this.saves.saveSoon(state));
    });
    effect(() => {
      const enabled = this.autosave();
      try {
        localStorage.setItem(AUTOSAVE_KEY, String(enabled));
      } catch {
        /* préférence non persistée */
      }
    });
  }

  newGame(managerName: string, clubId: string, seed: number): void {
    const state = createNewGame(managerName.trim() || 'Entraîneur', clubId, seed);
    this.store.load(state);
    this.router.navigate(['/jeu']);
  }

  continueSaved(): boolean {
    const state = this.saves.load();
    if (!state) {
      this.toast.show('Aucune sauvegarde trouvée.', 'error');
      return false;
    }
    this.store.load(state);
    this.router.navigate(['/jeu']);
    return true;
  }

  async importFile(file: File): Promise<void> {
    try {
      const state = await this.saves.import(file);
      this.store.load(state);
      this.saves.save(state);
      this.toast.show('Sauvegarde importée.', 'success');
      this.router.navigate(['/jeu']);
    } catch (e) {
      this.toast.show(e instanceof Error ? e.message : 'Import impossible.', 'error');
    }
  }

  saveNow(): void {
    const state = this.store.state();
    if (state && this.saves.save(state)) this.toast.show('Partie sauvegardée.', 'success');
  }

  exportSave(): void {
    const state = this.store.state();
    if (state) this.saves.export(state);
  }

  quit(): void {
    const state = this.store.state();
    if (state) this.saves.save(state);
    this.store.clear();
    this.router.navigate(['/']);
  }

  /**
   * Bouton « Continuer » : joue le match de l'utilisateur s'il y en a un,
   * sinon simule directement la semaine.
   */
  private remindedWeek = -1;

  advance(): void {
    // Sans club (limogé), le temps ne s'écoule pas tant qu'aucune offre n'est acceptée.
    if (this.store.unemployed()) return;
    if (this.store.state()?.events.length) {
      this.toast.show('Une décision vous attend : répondez à l’événement en cours.', 'error');
      return;
    }
    // Rappel (une fois par semaine) : la semaine de travail n'est pas terminée.
    const s = this.store.state();
    if (s && !s.liveMatch && !this.store.seasonOver()) {
      const todo = weekTodo(s);
      const key = s.season * 100 + s.currentWeek;
      if (todo > 0 && this.remindedWeek !== key) {
        this.remindedWeek = key;
        this.toast.show(`Il reste ${todo} tâche(s) dans votre semaine (préparation, entretiens, presse). Appuyez à nouveau pour continuer.`, 'info');
        this.router.navigate(['/jeu/semaine']);
        return;
      }
    }
    if (this.store.seasonOver()) {
      this.router.navigate(['/jeu']);
      return;
    }
    // Un match en direct est en cours (ou interrompu) : on y retourne.
    if (this.store.state()?.liveMatch) {
      this.router.navigate(['/jeu/match']);
      return;
    }
    if (this.store.userFixtureThisWeek()) {
      this.matchRequests.update((n) => n + 1);
      this.router.navigate(['/jeu/match']);
      return;
    }
    const label = this.store.currentWeek()?.label ?? '';
    this.store.mutate((s, rng, ids) => completeWeek(s, rng, ids));
    this.toast.show(`${label} : votre club ne jouait pas, les autres matchs ont été simulés.`);
  }

  /** Enregistre le résultat du match joué en direct puis termine la semaine. */
  finishUserMatch(fixtureId: string, result: MatchResult): void {
    this.store.mutate((s, rng, ids) => completeWeek(s, rng, ids, { fixtureId, result }));
  }

  startNextSeason(): void {
    this.store.mutate((s, rng, ids) => startNextSeason(s, rng, ids));
    const s = this.store.state()!;
    this.toast.show(`Bienvenue dans la saison ${s.season}-${s.season + 1} !`, 'success');
    this.router.navigate(['/jeu']);
  }

  markNewsRead(id?: string): void {
    this.store.mutate((s) => s.news.forEach((n) => (id === undefined || n.id === id) && (n.read = true)));
  }
}

function readAutosavePref(): boolean {
  try {
    return localStorage.getItem(AUTOSAVE_KEY) !== 'false';
  } catch {
    return true;
  }
}
