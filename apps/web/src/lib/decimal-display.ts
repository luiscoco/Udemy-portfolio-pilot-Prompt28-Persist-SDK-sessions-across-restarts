// Presentation only. Never convert financial strings to binary floating point.
export function decimalDisplay(value: string | null, places = 2): string {
  if (value === null) return 'Unavailable';
  const negative = value.startsWith('-');
  const [whole = '0', fraction = ''] = value.replace(/^-/, '').split('.');
  const scale = 10n ** BigInt(places);
  let units = BigInt(whole) * scale + BigInt((fraction + '0'.repeat(places)).slice(0, places) || '0');
  if ((fraction[places] ?? '0') >= '5') units++;
  const integer = (units / scale).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative && units !== 0n ? '-' : ''}${integer}${places ? '.' + (units % scale).toString().padStart(places, '0') : ''}`;
}
export const money = (value: string | null) => value === null ? 'Unavailable' : `USD ${decimalDisplay(value)}`;
export function quantity(value: string): string { return value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value; }
export function percent(weight: string | null): string {
  if (weight === null) return 'Unavailable';
  const [whole = '0', fraction = ''] = weight.split('.');
  const shifted = `${whole}${fraction.padEnd(2, '0').slice(0, 2)}`.replace(/^0+(?=\d)/, '');
  return `${decimalDisplay(`${shifted}.${fraction.slice(2) || '0'}`)}%`;
}
