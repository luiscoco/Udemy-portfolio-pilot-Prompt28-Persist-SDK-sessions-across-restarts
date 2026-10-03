/** Exact inventory in 10 decimal places; inputs are validated fixed-point strings. */
export function quantityUnits(value: string): bigint {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole!) * 10000000000n + BigInt(fraction.padEnd(10, '0'));
}
export function validateLongOnlyLedger(rows: readonly { securityId: string; side: 'BUY' | 'SELL'; quantity: string }[]): boolean {
  const balances = new Map<string, bigint>();
  for (const row of rows) {
    const next = (balances.get(row.securityId) ?? 0n) + (row.side === 'BUY' ? quantityUnits(row.quantity) : -quantityUnits(row.quantity));
    if (next < 0n) return false;
    balances.set(row.securityId, next);
  }
  return true;
}
