import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Player } from '../models';
import { GameStore } from './game-store.service';

/**
 * Fiche joueur accessible partout : un clic sur un nom ouvre la fiche (fenêtre modale du shell).
 * Les écrans Transferts et Effectif écoutent les demandes d'action émises depuis la fiche.
 */
@Injectable({ providedIn: 'root' })
export class PlayerCardService {
  private readonly store = inject(GameStore);
  private readonly router = inject(Router);

  readonly openId = signal<string | null>(null);
  /** Demande d'offre (écran Transferts). */
  readonly bidRequest = signal<string | null>(null);
  /** Joueur à sélectionner dans l'écran Effectif. */
  readonly squadFocus = signal<string | null>(null);

  /** Recherche dans le monde, puis dans le booster ouvert et le match en direct. */
  readonly player = computed<Player | null>(() => {
    const id = this.openId();
    const s = this.store.state();
    if (!id || !s) return null;
    return (
      this.store.playersById().get(id) ??
      s.pendingPack?.cards.find((c) => c.id === id) ??
      [...(s.liveMatch?.home.squad ?? []), ...(s.liveMatch?.away.squad ?? [])].find((p) => p.id === id) ??
      null
    );
  });

  open(id: string): void {
    this.openId.set(id);
  }

  close(): void {
    this.openId.set(null);
  }

  makeOffer(id: string): void {
    this.close();
    this.bidRequest.set(id);
    this.router.navigate(['/jeu/transferts']);
  }

  showInSquad(id: string): void {
    this.close();
    this.squadFocus.set(id);
    this.router.navigate(['/jeu/effectif']);
  }
}
