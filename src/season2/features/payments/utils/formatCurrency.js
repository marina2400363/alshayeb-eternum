// Shared amount formatting for every payment surface (overview, option
// picker, InstaPay panel, history) so "6,000 EGP" reads identically
// everywhere. Amounts are always plain numbers from the backend — never
// pre-formatted strings.
export function formatCurrency(amount) {
  const value = Number(amount);
  const safeValue = Number.isFinite(value) ? value : 0;
  return `${safeValue.toLocaleString("en-US")} EGP`;
}
