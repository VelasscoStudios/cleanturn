/** Format integer cents as CAD display text: $65 when whole, $65.50 otherwise. */
export function formatCents(cents: number): string {
  const whole = cents % 100 === 0;
  const value = cents / 100;
  return whole ? `$${value}` : `$${value.toFixed(2)}`;
}
