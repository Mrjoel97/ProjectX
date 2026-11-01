export function formatMerchantMoney(minor: number, currency: string): string {
  if (!Number.isSafeInteger(minor) || minor < 0 || !/^[A-Z]{3}$/.test(currency))
    return "Amount unavailable";
  const formatter = new Intl.NumberFormat("en", { style: "currency", currency });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(minor / 10 ** digits);
}
