import { Injectable, signal } from '@angular/core';
import { compressToUTF16, decompressFromUTF16 } from 'lz-string';
import { migrate } from '../engine/migrations';
import { GameState, SCHEMA_VERSION } from '../models';

const STORAGE_KEY = 'banc-de-touche.save';
const SUMMARY_KEY = 'banc-de-touche.summary';
/** Préfixe d'une sauvegarde compressée (lz-string) ; sans préfixe, c'est du JSON (anciennes versions). */
const PACKED = 'LZ1:';
/** Délai avant d'écrire une sauvegarde automatique : les changements rapprochés sont regroupés. */
const AUTOSAVE_DELAY = 900;

export interface SaveSummary {
  managerName: string;
  clubName: string;
  season: number;
  week: number;
  totalWeeks: number;
  savedAt: string;
}

/**
 * Persistance de la partie dans le localStorage, avec export/import JSON.
 * La partie est compressée (environ 13 fois plus petite) dans un Web Worker, pour que le monde
 * complet (6 championnats, plus de 2 500 joueurs) tienne largement dans le stockage du navigateur
 * sans bloquer l'interface.
 */
@Injectable({ providedIn: 'root' })
export class SaveService {
  readonly summary = signal<SaveSummary | null>(this.readSummary());
  readonly lastSavedAt = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  private worker: Worker | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: GameState | null = null;
  private seq = 0;

  constructor() {
    if (typeof Worker !== 'undefined') {
      try {
        this.worker = new Worker(new URL('./save.worker', import.meta.url), { type: 'module' });
        this.worker.onmessage = ({ data }: MessageEvent<{ id: number; packed: string }>) => {
          // Une écriture plus récente a pu être demandée entre-temps : seule la dernière compte.
          if (data.id === this.seq) this.write(PACKED + data.packed);
        };
      } catch {
        this.worker = null;
      }
    }
    // En quittant la page, une sauvegarde en attente est écrite immédiatement.
    if (typeof addEventListener !== 'undefined') addEventListener('pagehide', () => this.flush());
  }

  /** Sauvegarde automatique : différée et compressée hors du fil principal. */
  saveSoon(state: GameState): void {
    this.pending = state;
    this.summary.set(this.summarize(state));
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.saveAsync(), AUTOSAVE_DELAY);
  }

  /** Sauvegarde immédiate (bouton, import, sortie de partie). */
  save(state: GameState): boolean {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
    this.seq++;
    return this.write(PACKED + compressToUTF16(this.serialize(state)), state);
  }

  /** Écrit tout de suite une sauvegarde automatique en attente. */
  flush(): void {
    if (this.pending) this.save(this.pending);
  }

  load(): GameState | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const json = raw.startsWith(PACKED) ? decompressFromUTF16(raw.slice(PACKED.length)) : raw;
      return json ? this.parse(json) : null;
    } catch {
      return null;
    }
  }

  delete(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
    this.seq++;
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(SUMMARY_KEY);
    } catch {
      /* stockage indisponible */
    }
    this.summary.set(null);
  }

  private saveAsync(): void {
    const state = this.pending;
    this.timer = null;
    if (!state) return;
    this.pending = null;
    if (!this.worker) {
      this.save(state);
      return;
    }
    this.lastState = state;
    this.worker.postMessage({ id: ++this.seq, json: this.serialize(state) });
  }

  private lastState: GameState | null = null;

  private serialize(state: GameState): string {
    return JSON.stringify({ ...state, savedAt: new Date().toISOString() });
  }

  private write(packed: string, state: GameState | null = this.lastState): boolean {
    try {
      localStorage.setItem(STORAGE_KEY, packed);
      const savedAt = new Date().toISOString();
      if (state) {
        const summary = this.summarize({ ...state, savedAt });
        localStorage.setItem(SUMMARY_KEY, JSON.stringify(summary));
        this.summary.set(summary);
      }
      this.lastSavedAt.set(savedAt);
      this.error.set(null);
      return true;
    } catch {
      this.error.set('Sauvegarde impossible : le stockage du navigateur est plein ou désactivé.');
      return false;
    }
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
    try {
      const raw = localStorage.getItem(SUMMARY_KEY);
      if (raw) return JSON.parse(raw) as SaveSummary;
    } catch {
      /* résumé illisible : on relit la partie */
    }
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
