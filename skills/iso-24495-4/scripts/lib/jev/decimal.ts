// Exact decimal arithmetic for cut-offs (section 8).
//
// A score is read from the raw response as the number token the service
// wrote, never through a double, so every digit it wrote is kept. Sums,
// differences and rounding up then run on whole numbers scaled by a power of
// ten, so no binary error moves a value across a hundredth.

/** The value units / 10^scale. */
export interface Decimal {
  units: bigint;
  scale: number;
}

/** A number as JSON writes it. */
const JSON_NUMBER = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

function power(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

/** The same value at a larger scale. */
function rescale(value: Decimal, scale: number): bigint {
  return value.units * power(scale - value.scale);
}

/**
 * A JSON number token, exactly as written.
 *
 * @param token The number alone, with no space around it. An exponent is
 *     applied in full, so 1e400 becomes a whole number of 401 digits.
 * @returns The value with every digit kept and a scale of zero or more.
 * @throws An `Error` giving the length of the token when it is not a JSON
 *     number. That covers empty text, a leading plus sign, and words such as
 *     NaN. Nothing is returned for bad input.
 */
export function parseDecimal(token: string): Decimal {
  const match = JSON_NUMBER.exec(token);
  if (match === null) {
    throw new Error(`Expected a JSON number such as 0.25 or -1e3; got ${token.length} characters that are not one.`);
  }
  const [, sign, whole, fraction = "", exponent = "0"] = match as unknown as [string, string, string, string?, string?];
  const units = BigInt(`${sign}${whole}${fraction}`);
  const scale = fraction.length - Number(exponent);
  return scale >= 0 ? { units, scale } : { units: units * power(-scale), scale: 0 };
}

export const ZERO: Decimal = { units: 0n, scale: 0 };
export const ONE: Decimal = { units: 1n, scale: 0 };

/** The exact sum, held at the larger of the two scales. */
export function add(first: Decimal, second: Decimal): Decimal {
  const scale = Math.max(first.scale, second.scale);
  return { units: rescale(first, scale) + rescale(second, scale), scale };
}

/** The first less the second, exactly, held at the larger of the two scales. */
export function subtract(first: Decimal, second: Decimal): Decimal {
  return add(first, { units: -second.units, scale: second.scale });
}

/** Below zero, zero or above zero, as the first is less than, equal to or greater than the second. */
export function compare(first: Decimal, second: Decimal): number {
  const scale = Math.max(first.scale, second.scale);
  const difference = rescale(first, scale) - rescale(second, scale);
  return difference === 0n ? 0 : difference > 0n ? 1 : -1;
}

/**
 * The largest value in the list, and the first of them where several are equal.
 *
 * @throws A `TypeError` when the list is empty.
 */
export function maximum(values: readonly Decimal[]): Decimal {
  return values.reduce((largest, value) => (compare(value, largest) > 0 ? value : largest));
}

/**
 * The smallest value in the list, and the first of them where several are equal.
 *
 * @throws A `TypeError` when the list is empty.
 */
export function minimum(values: readonly Decimal[]): Decimal {
  return values.reduce((smallest, value) => (compare(value, smallest) < 0 ? value : smallest));
}

/**
 * The smallest value with the given number of decimal places that is not below this one.
 *
 * @param places Digits after the decimal point: a whole number, zero or more.
 * @returns A value whose scale is exactly `places`. One that already had
 *     fewer places is unchanged in value and padded to that scale. A negative
 *     value moves towards zero, which is upwards.
 */
export function ceilToPlaces(value: Decimal, places: number): Decimal {
  if (value.scale <= places) return { units: rescale(value, places), scale: places };
  const divisor = power(value.scale - places);
  const truncated = value.units / divisor;
  // Division truncates towards zero, which is already upwards for a negative value.
  const up = value.units > 0n && value.units % divisor !== 0n ? 1n : 0n;
  return { units: truncated + up, scale: places };
}

/**
 * The value as plain decimal text, with no trailing zeros: exact, for records such as a cut-off.
 *
 * @returns Digits with a point only where a fraction remains, and never an
 *     exponent. Zero is "0", at any scale.
 */
export function decimalText(value: Decimal): string {
  const digits = (value.units < 0n ? -value.units : value.units).toString().padStart(value.scale + 1, "0");
  const whole = digits.slice(0, digits.length - value.scale);
  const fraction = digits.slice(digits.length - value.scale).replace(/0+$/, "");
  const sign = value.units < 0n ? "-" : "";
  return `${sign}${whole}${fraction === "" ? "" : `.${fraction}`}`;
}

/** The double nearest the value, for display only. */
export function toNumber(value: Decimal): number {
  return Number(decimalText(value));
}
