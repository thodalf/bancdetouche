import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { maxScouts, SINGLE_ROLES } from '../../core/engine/characters';
import { LifestyleId, STAFF_ROLE_LABELS, StaffRole } from '../../core/models';
import { GameStore } from '../../core/services/game-store.service';
import { StaffService } from '../../core/services/staff.service';
import { FlagPipe } from '../../shared/pipes/labels.pipe';
import { MoneyPipe } from '../../shared/pipes/money.pipe';

type RoleFilter = StaffRole | 'all';

@Component({
  selector: 'app-staff',
  imports: [RouterLink, MoneyPipe, FlagPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './staff.component.html',
  styleUrl: './staff.component.scss',
})
export class StaffComponent {
  protected readonly store = inject(GameStore);
  protected readonly staff = inject(StaffService);

  protected readonly roleLabels = STAFF_ROLE_LABELS;
  protected readonly roleFilters: RoleFilter[] = ['all', 'assistant', 'fitness', 'doctor', 'youth', 'director', 'scout'];
  protected readonly marketFilter = signal<RoleFilter>('all');
  /** Membre dont le licenciement attend confirmation. */
  protected readonly confirmFire = signal<string | null>(null);
  protected readonly changingLifestyle = signal(false);

  protected readonly vacancies = computed(() => {
    const s = this.store.state();
    if (!s) return [];
    const out: { role: StaffRole; text: string }[] = SINGLE_ROLES.filter((r) => !s.staff.some((m) => m.role === r)).map((r) => ({ role: r, text: 'Poste vacant' }));
    const scouts = s.staff.filter((m) => m.role === 'scout').length;
    const max = maxScouts(s);
    if (scouts < max) out.push({ role: 'scout', text: `${max - scouts} place(s) de recruteur libre(s)` });
    return out;
  });
  protected readonly scoutCap = computed(() => {
    const s = this.store.state();
    return s ? maxScouts(s) : 1;
  });

  protected readonly market = computed(() => {
    const f = this.marketFilter();
    return this.staff.market().filter((c) => f === 'all' || c.member.role === f);
  });

  protected readonly lifestyle = computed(() => {
    const m = this.staff.manager();
    if (!m?.lifestyle) return null;
    const def = this.staff.lifestyles.find((l) => l.id === m.lifestyle)!;
    let nextFound = false;
    return {
      ...def,
      perks: def.perks.map((p) => {
        const owned = m.perks.includes(p.id);
        const next = !owned && !nextFound;
        if (next) nextFound = true;
        return { ...p, owned, next, lines: this.staff.effectLinesOf(p.effects) };
      }),
    };
  });

  protected readonly otherPerks = computed(() => {
    const m = this.staff.manager();
    if (!m) return [];
    return this.staff.lifestyles.filter((l) => l.id !== m.lifestyle).flatMap((l) => l.perks.filter((p) => m.perks.includes(p.id)).map((p) => `${p.label} (${l.label})`));
  });

  protected opinionLabel(v: number): string {
    if (v >= 75) return 'Dévoué';
    if (v >= 50) return 'Satisfait';
    if (v >= 30) return 'Réservé';
    if (v >= 15) return 'Mécontent';
    return 'Prêt à partir';
  }

  protected fire(id: string): void {
    if (this.confirmFire() !== id) {
      this.confirmFire.set(id);
      return;
    }
    this.confirmFire.set(null);
    this.staff.fire(id);
  }

  protected choose(id: LifestyleId): void {
    this.staff.chooseLifestyle(id);
    this.changingLifestyle.set(false);
  }
}
