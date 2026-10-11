import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { GameStore } from '../services/game-store.service';
import { SaveService } from '../services/save.service';

/** Accès aux écrans de jeu : recharge la sauvegarde si besoin (rafraîchissement de page), sinon retour à l'accueil. */
export const gameGuard: CanActivateFn = () => {
  const store = inject(GameStore);
  if (store.hasGame()) return true;
  const saved = inject(SaveService).load();
  if (saved) {
    store.load(saved);
    return true;
  }
  return inject(Router).createUrlTree(['/']);
};
