import { Injectable } from '@angular/core';

/** Action « suivant » : retourne true si elle a géré la touche. */
export type NextHandler = () => boolean;

/**
 * Touche Espace = « suivant ». Les écrans peuvent empiler leur propre action
 * (l'écran de match lance le direct, valide le résultat…) ; sinon on avance d'une semaine.
 */
@Injectable({ providedIn: 'root' })
export class HotkeyService {
  private readonly handlers: NextHandler[] = [];

  register(handler: NextHandler): () => void {
    this.handlers.push(handler);
    return () => {
      const i = this.handlers.lastIndexOf(handler);
      if (i >= 0) this.handlers.splice(i, 1);
    };
  }

  /** Exécute le gestionnaire le plus récent, puis l'action par défaut s'il n'a rien fait. */
  next(fallback: () => void): void {
    for (let i = this.handlers.length - 1; i >= 0; i--) {
      if (this.handlers[i]()) return;
    }
    fallback();
  }

  /** La touche ne doit pas agir quand on tape dans un champ ou qu'une fenêtre est ouverte. */
  static shouldIgnore(event: KeyboardEvent): boolean {
    if (event.code !== 'Space' || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return true;
    const target = event.target as HTMLElement | null;
    if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return true;
    return !!document.querySelector('[role="dialog"], [role="alertdialog"]');
  }
}
