function parseLocalizedAmount(raw: string) {
  const compact = raw.replace(/[ \t]/g, "");
  const lastSeparator = Math.max(compact.lastIndexOf(","), compact.lastIndexOf("."));
  const decimalDigits = lastSeparator >= 0 ? compact.length - lastSeparator - 1 : 0;
  if (decimalDigits === 2) {
    const integer = compact.slice(0, lastSeparator).replace(/[.,]/g, "");
    return Number(`${integer}.${compact.slice(lastSeparator + 1)}`);
  }
  return Number(compact.replace(/[.,]/g, ""));
}

export function extractAmountsFromText(text: string) {
  const pattern = /(?:\$|COP|TOTAL|MONTO|VALOR)[ \t]*[:$]?[ \t]*(\d[\d., \t]*)/gi;
  const amounts = [...text.matchAll(pattern)]
    .map((match) => parseLocalizedAmount(match[1]))
    .filter((amount) => Number.isFinite(amount) && amount > 0);
  return [...new Set(amounts)];
}
