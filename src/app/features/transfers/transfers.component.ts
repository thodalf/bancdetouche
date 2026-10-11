import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { PlayerCardService } from '../../core/services/player-card.service';
import { PlayerLinkComponent } from '../../shared/components/player-link.component';
import { MAX_SQUAD, requiredReputation } from '../../core/engine/transfers';
import { marketValue } from '../../core/engine/valuation';
import { POSITION_GROUP, PositionGroup } from '../../core/models';
import { GameStore } from '../../core/services/game-store.service';
import { MarketEntry, TransferService } from '../../core/services/transfer.service';
import { ClubCrestComponent } from '../../shared/components/club-crest.component';
import { RatingComponent } from '../../shared/components/rating.component';
import { ScoutedRatingComponent } from '../../shared/components/scouted-rating.component';
import { ContractDialogComponent } from '../contracts/contract-dialog.component';
import { PotentialStarsComponent } from '../../shared/components/potential-stars.component';
import { FlagPipe, PlayerNamePipe, PositionPipe } from '../../shared/pipes/labels.pipe';
import { MoneyPipe } from '../../shared/pipes/money.pipe';

type Tab = 'market' | 'scouting' | 'offers' | 'selling';
type Source = 'all' | 'listed' | 'free' | 'booster';
type SortKey = 'rating' | 'age' | 'price' | 'wage' | 'potential';

@Component({
  selector: 'app-transfers',
  imports: [RatingComponent, ScoutedRatingComponent, PotentialStarsComponent, ContractDialogComponent, ClubCrestComponent, PlayerLinkComponent, MoneyPipe, PositionPipe, FlagPipe, PlayerNamePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './transfers.component.html',
  styleUrl: './transfers.component.scss',
})
export class TransfersComponent {
  protected readonly store = inject(GameStore);
  protected readonly transfers = inject(TransferService);
  protected readonly groupOf = POSITION_GROUP;
  protected readonly maxSquad = MAX_SQUAD;

  protected readonly tab = signal<Tab>('market');

  // ---- filtres du marché
  protected readonly search = signal('');
  protected readonly group = signal<PositionGroup | 'ALL'>('ALL');
  protected readonly source = signal<Source>('listed');
  protected readonly maxPriceM = signal<number | null>(null);
  protected readonly minRating = signal(0);
  protected readonly affordableOnly = signal(false);
  protected readonly sortKey = signal<SortKey>('rating');
  protected readonly limit = signal(40);

  protected readonly club = computed(() => this.store.userClub()!);

  protected readonly filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    const g = this.group();
    const src = this.source();
    const maxPrice = this.maxPriceM() !== null ? this.maxPriceM()! * 1_000_000 : Infinity;
    const minRating = this.minRating();
    const budget = this.club().transferBudget;
    const key = this.sortKey();
    return this.transfers
      .market()
      .filter((e) => {
        const p = e.player;
        if (src === 'listed' && !(p.transferListed || !p.clubId)) return false;
        if (src === 'free' && p.clubId) return false;
        if (src === 'booster' && !p.scoutedBy) return false;
        if (g !== 'ALL' && POSITION_GROUP[p.position] !== g) return false;
        // Les filtres et tris utilisent l'estimation, jamais la note cachée.
        if (e.view.estimate < minRating || e.price > maxPrice) return false;
        if (this.affordableOnly() && e.price > budget) return false;
        return !q || `${p.firstName} ${p.lastName} ${e.clubName}`.toLowerCase().includes(q);
      })
      .sort((a, b) => {
        switch (key) {
          case 'age':
            return a.player.age - b.player.age;
          case 'price':
            return a.price - b.price;
          case 'wage':
            return a.wageDemand - b.wageDemand;
          case 'potential':
            return (this.store.potentialOf(b.player)?.stars ?? 0) - (this.store.potentialOf(a.player)?.stars ?? 0);
          default:
            return b.view.estimate - a.view.estimate;
        }
      });
  });
  protected readonly visible = computed(() => this.filtered().slice(0, this.limit()));

  protected readonly offers = computed(() => {
    const players = this.store.playersById();
    const clubs = this.store.clubsById();
    return this.store.pendingOffers().map((o) => {
      const player = players.get(o.playerId)!;
      return { offer: o, player, club: clubs.get(o.fromClubId)!, value: marketValue(player) };
    });
  });

  /** Joueurs observés en ce moment et rapports complets (hors effectif). */
  protected readonly scouted = computed(() => {
    const s = this.store.state();
    if (!s) return { active: [], reports: [] };
    const all = this.transfers.market();
    return {
      active: all.filter((e) => e.scouting),
      reports: all.filter((e) => !e.scouting && e.knowledge >= 100),
    };
  });

  /** Joueur avec lequel on négocie un contrat. */
  protected readonly negotiating = signal<string | null>(null);

  protected readonly listed = computed(() =>
    this.store
      .userSquad()
      .filter((p) => p.transferListed)
      .map((p) => ({ p, value: marketValue(p) })),
  );

  protected readonly wageRoom = computed(() => this.club().wageBudget - this.store.userWageBill());

  // ---- dialogue d'offre
  protected readonly bidTarget = signal<MarketEntry | null>(null);
  protected readonly bidAmountM = signal(0);
  protected readonly bidMessage = signal<string | null>(null);

  protected readonly bidWarnings = computed(() => {
    const e = this.bidTarget();
    if (!e) return [];
    const out: string[] = [];
    const club = this.club();
    if (e.wageDemand > this.wageRoom()) out.push(`Salaire réclamé supérieur à votre marge salariale (${Math.round(this.wageRoom() / 1000)} k€/sem.).`);
    if (club.reputation < requiredReputation(e.player)) out.push('Ce joueur juge votre club pas assez prestigieux.');
    if (this.bidAmountM() * 1_000_000 > club.transferBudget) out.push('Montant supérieur à votre budget transferts.');
    if (this.store.userSquad().length >= MAX_SQUAD) out.push('Effectif complet.');
    if (e.player.releaseClause !== null && e.knowledge >= 50) out.push(`Clause libératoire connue : ${(e.player.releaseClause / 1e6).toFixed(1).replace('.', ',')} M€ (le club ne peut pas refuser).`);
    return out;
  });

  constructor() {
    // « Faire une offre » depuis la fiche joueur.
    const card = inject(PlayerCardService);
    effect(() => {
      const id = card.bidRequest();
      if (!id) return;
      untracked(() => {
        card.bidRequest.set(null);
        const entry = this.transfers.market().find((e) => e.player.id === id);
        if (entry) {
          this.tab.set('market');
          this.openBid(entry);
        }
      });
    });
  }

  protected openBid(entry: MarketEntry): void {
    if (!entry.player.clubId) {
      // Joueur libre : pas d'indemnité, on passe directement au contrat.
      if (this.transfers.bid(entry.player.id, 0).ok) this.negotiating.set(entry.player.id);
      return;
    }
    this.bidTarget.set(entry);
    this.bidAmountM.set(Math.round((entry.price / 1_000_000) * 100) / 100);
    this.bidMessage.set(null);
  }

  protected submitBid(): void {
    const e = this.bidTarget();
    if (!e) return;
    const amount = e.player.clubId ? Math.round(this.bidAmountM() * 1_000_000) : 0;
    const outcome = this.transfers.bid(e.player.id, amount);
    if (outcome.ok) {
      this.bidTarget.set(null);
      // Indemnité acceptée (ou joueur libre) : place à la négociation du contrat.
      if (outcome.stage === 'contract') this.negotiating.set(e.player.id);
      return;
    }
    this.bidMessage.set(outcome.message);
    if (outcome.counter) this.bidAmountM.set(Math.round((outcome.counter / 1_000_000) * 100) / 100);
  }

  protected numberValue(event: Event): number {
    const v = parseFloat((event.target as HTMLInputElement).value.replace(',', '.'));
    return Number.isFinite(v) ? v : 0;
  }

  protected setMaxPrice(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    this.maxPriceM.set(raw === '' ? null : this.numberValue(event));
  }
}
