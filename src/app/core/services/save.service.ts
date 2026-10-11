import { Injectable, signal } from '@angular/core';
import { migrate } from '../engine/migrations';
import { GameState, SCHEMA_VERSION } from '../models';

const STORAGE_KEY = 'banc-de-touche.save';

export interface SaveSummary {
  managerName: string;
  clubName: string;
  season: number;
  week: number;
  totalWeeks: number;
  savedAt: string;
}

/** Persistance de la partie dans le localStorage, avec export/import JSON. */
@Injectable({ providedIn: 'root' })
export class SaveService {
  readonly summary = signal<SaveSummary | null>(this.readSummary());
  readonly lastSavedAt = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  save(state: GameState): boolean {
    try {
      const savedAt = new Date().toISOString();
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, savedAt }));
      this.lastSavedAt.set(savedAt);
      this.summary.set(this.summarize({ ...state, savedAt }));
      this.error.set(null);
      return true;
    } catch {
      this.error.set('Sauvegarde impossible : le stockage du navigateur est plein ou désactivé.');
      return false;
    }
  }

  load(): GameState | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? this.parse(raw) : null;
    } catch {
      return null;
    }
  }

  delete(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* stockage indisponible */
    }
    this.summary.set(null);
  }

  /** Télécharge la partie au format JSON. */
  export(state: GameState): void {
    const blob = new Blob([JSON.stringify(state)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `banc-de-touche-${state.season}-s${state.currentWeek + 1}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async import(file: File): Promise<GameState> {
    const state = this.parse(await file.text());
    if (!state) throw new Error('Ce fichier n\'est pas une sauvegarde Banc de touche valide.');
    return state;
  }

  /** Lecture + migration éventuelle des anciennes versions du schéma. */
  private parse(raw: string): GameState | null {
    const data = JSON.parse(raw) as Partial<GameState>;
    if (!data || typeof data !== 'object' || !Array.isArray(data.clubs) || !data.userClubId) return null;
    if ((data.schemaVersion ?? 0) > SCHEMA_VERSION) return null;
    // Les anciennes versions du schéma sont mises à niveau étape par étape.
    return migrate(data as GameState);
  }

  private readSummary(): SaveSummary | null {
    const s = this.load();
    return s ? this.summarize(s) : null;
  }

  private summarize(s: GameState): SaveSummary {
    return {
      managerName: s.managerName,
      clubName: s.clubs.find((c) => c.id === s.userClubId)?.name ?? '?',
      season: s.season,
      week: Math.min(s.currentWeek + 1, s.weeks.length),
      totalWeeks: s.weeks.length,
      savedAt: s.savedAt ?? s.createdAt,
    };
  }
}
