import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FinanceCategory } from '../../core/models';
import { GameStore } from '../../core/services/game-store.service';
import { MeterComponent } from '../../shared/components/rating.component';
import { MoneyPipe } from '../../shared/pipes/money.pipe';

const CATEGORY_LABELS: Record<FinanceCategory, string> = {
  gate: 'Billetterie',
  tv: 'Droits TV',
  sponsor: 'Sponsors',
  prize: 'Primes',
  transferIn: 'Ventes de joueurs',
  wages: 'Salaires et fonctionnement',
  transferOut: 'Achats de joueurs',
  severance: 'Indemnités de départ',
  bonus: 'Primes à la signature',
  facilities: 'Infrastructures',
  booster: 'Boosters',
  staff: 'Staff',
};

import { PlayerLinkComponent } from '../../shared/components/player-link.component';

@Component({
  selector: 'app-finances',
  imports: [PlayerLinkComponent, MoneyPipe, MeterComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './finances.component.html',
  styleUrl: './finances.component.scss',
})
export class FinancesComponent {
  protected readonly store = inject(GameStore);
  protected readonly club = computed(() => this.store.userClub()!);
  protected readonly ledgerLimit = signal(25);

  private readonly seasonLedger = computed(() => {
    const s = this.store.state()!;
    return s.ledger.filter((e) => e.season === s.season && e.clubId === s.userClubId);
  });

  protected readonly breakdown = computed(() => {
    const totals = new Map<FinanceCategory, number>();
    for (const e of this.seasonLedger()) totals.set(e.category, (totals.get(e.category) ?? 0) + e.amount);
    const rows = [...totals.entries()].map(([cat, amount]) => ({ label: CATEGORY_LABELS[cat], amount }));
    const max = Math.max(1, ...rows.map((r) => Math.abs(r.amount)));
    return {
      income: rows.filter((r) => r.amount > 0).sort((a, b) => b.amount - a.amount).map((r) => ({ ...r, pct: (r.amount / max) * 100 })),
      expenses: rows.filter((r) => r.amount < 0).sort((a, b) => a.amount - b.amount).map((r) => ({ ...r, pct: (-r.amount / max) * 100 })),
      net: rows.reduce((s, r) => s + r.amount, 0),
    };
  });

  /** Solde net semaine par semaine pour le petit graphique. */
  protected readonly weekly = computed(() => {
    const s = this.store.state()!;
    const byWeek = new Map<number, number>();
    for (const e of this.seasonLedger()) byWeek.set(e.week, (byWeek.get(e.week) ?? 0) + e.amount);
    const weeks = Array.from({ length: Math.min(s.currentWeek, s.weeks.length) }, (_, i) => ({ week: i, net: byWeek.get(i) ?? 0 }));
    const max = Math.max(1, ...weeks.map((w) => Math.abs(w.net)));
    return weeks.map((w) => ({ ...w, h: (Math.abs(w.net) / max) * 100 }));
  });

  private readonly clubLedger = computed(() => {
    const s = this.store.state()!;
    return s.ledger.filter((e) => e.clubId === s.userClubId);
  });
  protected readonly recent = computed(() => [...this.clubLedger()].reverse().slice(0, this.ledgerLimit()));
  protected readonly ledgerSize = computed(() => this.clubLedger().length);

  protected readonly wageUsage = computed(() => (this.store.userWageBill() / this.club().wageBudget) * 100);

  protected readonly topEarners = computed(() => [...this.store.userSquad()].sort((a, b) => b.wage - a.wage).slice(0, 8));

  protected weekLabel(week: number): string {
    return this.store.state()!.weeks[week]?.label ?? `Semaine ${week + 1}`;
  }
}
