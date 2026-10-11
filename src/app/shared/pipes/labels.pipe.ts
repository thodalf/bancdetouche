import { Pipe, PipeTransform } from '@angular/core';
import { NATIONALITY_FLAGS } from '../../core/data/names.data';
import { Player, Position, POSITION_LABELS } from '../../core/models';

@Pipe({ name: 'pos' })
export class PositionPipe implements PipeTransform {
  transform(p: Position): string {
    return POSITION_LABELS[p];
  }
}

@Pipe({ name: 'flag' })
export class FlagPipe implements PipeTransform {
  transform(nationality: string): string {
    return NATIONALITY_FLAGS[nationality] ?? '🏳️';
  }
}

@Pipe({ name: 'playerName' })
export class PlayerNamePipe implements PipeTransform {
  transform(p: Player | null | undefined, short = false): string {
    if (!p) return '—';
    return short ? `${p.firstName.charAt(0)}. ${p.lastName}` : `${p.firstName} ${p.lastName}`;
  }
}

/** Date ISO (aaaa-mm-jj) → « sam. 9 août 2026 ». */
@Pipe({ name: 'matchDate' })
export class MatchDatePipe implements PipeTransform {
  transform(iso: string | null | undefined, withYear = true): string {
    if (!iso) return '';
    const d = new Date(`${iso}T12:00:00`);
    return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long', ...(withYear ? { year: 'numeric' } : {}) });
  }
}
