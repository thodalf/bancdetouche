import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, output, signal } from '@angular/core';
import { defaultOffer, maxRounds, NegotiationResult } from '../../core/engine/contracts';
import { marketValue } from '../../core/engine/valuation';
import { SQUAD_STATUS_LABELS, SQUAD_STATUS_ORDER, SquadStatus } from '../../core/models';
import { GameStore } from '../../core/services/game-store.service';
import { TransferService } from '../../core/services/transfer.service';
import { PlayerNamePipe } from '../../shared/pipes/labels.pipe';
import { MoneyPipe } from '../../shared/pipes/money.pipe';

/**
 * Négociation de contrat (prolongation, transfert ou joueur libre) :
 * salaire, durée, prime à la signature, clause libératoire et statut dans l'effectif.
 */
@Component({
  selector: 'app-contract-dialog',
  imports: [MoneyPipe, PlayerNamePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './contract-dialog.component.html',
  styleUrl: './contract-dialog.component.scss',
})
export class ContractDialogComponent implements OnInit {
  private readonly store = inject(GameStore);
  private readonly transfers = inject(TransferService);

  readonly playerId = input.required<string>();
  readonly closed = output<boolean>();

  protected readonly statuses = SQUAD_STATUS_ORDER.map((id) => ({ id, label: SQUAD_STATUS_LABELS[id] }));
  protected readonly statusLabels = SQUAD_STATUS_LABELS;
  protected readonly maxRounds = computed(() => { const s = this.store.state(); return s ? maxRounds(s) : 3; });

  protected readonly player = computed(() => this.store.playersById().get(this.playerId()) ?? null);
  protected readonly context = computed(() => this.transfers.context(this.playerId()));
  protected readonly demands = computed(() => this.transfers.demands(this.playerId()));
  protected readonly agreement = computed(() => this.transfers.agreements().find((a) => a.playerId === this.playerId()) ?? null);
  protected readonly value = computed(() => {
    const p = this.player();
    return p ? marketValue(p) : 0;
  });

  // Champs du formulaire (montants saisis en k€ / M€ pour rester lisibles).
  protected readonly wageK = signal(0);
  protected readonly years = signal(3);
  protected readonly bonusK = signal(0);
  protected readonly withClause = signal(false);
  protected readonly clauseM = signal(0);
  protected readonly status = signal<SquadStatus>('rotation');

  protected readonly result = signal<NegotiationResult | null>(null);
  protected readonly roundsUsed = signal(0);

  protected readonly wageRoom = computed(() => {
    const club = this.store.userClub();
    const p = this.player();
    if (!club || !p) return 0;
    const own = this.context() === 'renewal' ? p.wage : 0;
    return club.wageBudget - this.store.userWageBill() + own;
  });

  ngOnInit(): void {
    const d = this.demands();
    if (!d) return;
    const start = defaultOffer(d);
    // On ouvre la discussion un peu sous les attentes du joueur : à l'entraîneur d'ajuster.
    this.wageK.set(Math.round((start.wage * 0.9) / 100) / 10);
    this.years.set(start.years);
    this.status.set(start.status);
    this.withClause.set(start.releaseClause !== null);
    this.clauseM.set(start.releaseClause ? Math.round(start.releaseClause / 100_000) / 10 : Math.round((this.value() * 2) / 100_000) / 10);
    this.roundsUsed.set(this.transfers.roundsUsed(this.playerId()));
  }

  protected num(event: Event): number {
    const v = parseFloat((event.target as HTMLInputElement).value.replace(',', '.'));
    return Number.isFinite(v) ? v : 0;
  }

  protected submit(): void {
    const res = this.transfers.negotiate(this.playerId(), {
      wage: Math.round(this.wageK() * 1000),
      years: this.years(),
      signingBonus: Math.round(this.bonusK() * 1000),
      releaseClause: this.withClause() ? Math.round(this.clauseM() * 1_000_000) : null,
      status: this.status(),
    });
    this.result.set(res);
    this.roundsUsed.set(this.transfers.roundsUsed(this.playerId()));
    if (res.outcome === 'accepted') this.closed.emit(true);
    if (res.outcome === 'walkout') this.roundsUsed.set(this.maxRounds());
  }

  /** Reprend la contre-proposition de l'agent dans le formulaire. */
  protected applyCounter(): void {
    const c = this.result()?.counter;
    if (!c) return;
    this.wageK.set(Math.round(c.wage / 100) / 10);
    this.years.set(c.years);
    this.status.set(c.status);
    this.withClause.set(c.releaseClause !== null);
    if (c.releaseClause) this.clauseM.set(Math.round(c.releaseClause / 100_000) / 10);
  }

  protected satisfactionPct(): number {
    const s = this.result()?.satisfaction ?? 0;
    return Math.max(4, Math.min(100, Math.round(((s - 0.6) / 0.4) * 100)));
  }
}
