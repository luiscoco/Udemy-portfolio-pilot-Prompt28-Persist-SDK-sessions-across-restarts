/** SDK costs arrive as numbers. Parse their decimal representation and round using integers. */
export function usdMicros(value: number, rounding: 'up' | 'down'): number {
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(String(value));
  if (!match) return NaN;
  const fraction = match[2] ?? '';
  const coefficient = BigInt(match[1]! + fraction);
  const shift = 6 + Number(match[3] ?? 0) - fraction.length;
  let units: bigint;
  if (shift >= 0) units = coefficient * 10n ** BigInt(shift);
  else {
    const divisor = 10n ** BigInt(-shift);
    units = coefficient / divisor + (rounding === 'up' && coefficient % divisor !== 0n ? 1n : 0n);
  }
  const result = Number(units);
  return Number.isSafeInteger(result) ? result : NaN;
}
export function usdString(micros: number): string {
  const digits = BigInt(micros).toString().padStart(7, '0');
  return `${digits.slice(0, -6)}.${digits.slice(-6)}`;
}
