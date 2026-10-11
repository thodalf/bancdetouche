import { Pipe, PipeTransform } from '@angular/core';

/** Montants compacts à la française : 1,2 M€ · 350 k€ · 900 €. */
export function formatMoney(value: number | null | undefined, signed = false): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const sign = value < 0 ? '−' : signed && value > 0 ? '+' : '';
  const abs = Math.abs(value);
  let body: string;
  if (abs >= 1_000_000) body = `${(abs / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: abs >= 100_000_000 ? 0 : 1 })} M€`;
  else if (abs >= 1_000) body = `${Math.round(abs / 1_000).toLocaleString('fr-FR')} k€`;
  else body = `${Math.round(abs)} €`;
  return sign + body;
}

@Pipe({ name: 'money' })
export class MoneyPipe implements PipeTransform {
  transform(value: number | null | undefined, signed = false): string {
    return formatMoney(value, signed);
  }
}
