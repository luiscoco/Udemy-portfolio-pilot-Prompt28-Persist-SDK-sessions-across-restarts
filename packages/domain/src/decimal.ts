/** Exact rational arithmetic over decimal inputs. No intermediate rounding. */
export class ExactDecimal {
  readonly numerator: bigint;
  readonly denominator: bigint;
  constructor(numerator: bigint, denominator = 1n) {
    if (denominator === 0n) throw new Error('Division by zero');
    if (denominator < 0n) { numerator = -numerator; denominator = -denominator; }
    let a = numerator < 0n ? -numerator : numerator; let b = denominator;
    while (b) { const remainder = a % b; a = b; b = remainder; }
    this.numerator = numerator / a; this.denominator = denominator / a;
  }
  static parse(value: string): ExactDecimal {
    if (!/^(0|[1-9]\d{0,17})(\.\d{1,10})?$/.test(value)) throw new Error('Invalid decimal');
    const [whole, fraction = ''] = value.split('.');
    return new ExactDecimal(BigInt(whole! + fraction), 10n ** BigInt(fraction.length));
  }
  /** Signed variant for calculated outputs such as realized losses ("-18.00"). */
  static parseSigned(value: string): ExactDecimal {
    const negative = value.startsWith('-');
    const magnitude = ExactDecimal.parse(negative ? value.slice(1) : value);
    return negative ? new ExactDecimal(-magnitude.numerator, magnitude.denominator) : magnitude;
  }
  add(other: ExactDecimal) { return new ExactDecimal(this.numerator * other.denominator + other.numerator * this.denominator, this.denominator * other.denominator); }
  subtract(other: ExactDecimal) { return this.add(new ExactDecimal(-other.numerator, other.denominator)); }
  multiply(other: ExactDecimal) { return new ExactDecimal(this.numerator * other.numerator, this.denominator * other.denominator); }
  divide(other: ExactDecimal) { return new ExactDecimal(this.numerator * other.denominator, this.denominator * other.numerator); }
  compare(other: ExactDecimal) { const difference = this.numerator * other.denominator - other.numerator * this.denominator; return difference < 0n ? -1 : difference > 0n ? 1 : 0; }
  /** Output boundary: half up (ties away from zero), fixed decimal places. */
  fixed(places: number): string {
    const negative = this.numerator < 0n;
    const scaled = (negative ? -this.numerator : this.numerator) * 10n ** BigInt(places);
    const units = scaled / this.denominator + (scaled % this.denominator * 2n >= this.denominator ? 1n : 0n);
    const digits = units.toString().padStart(places + 1, '0');
    return `${negative && units !== 0n ? '-' : ''}${places ? digits.slice(0, -places) + '.' + digits.slice(-places) : digits}`;
  }
}
