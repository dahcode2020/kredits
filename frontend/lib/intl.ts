/**
 * Normalisation des sorties `Intl`.
 *
 * Pourquoi: le séparateur de milliers et l'espace avant le symbole monétaire ne sont PAS
 * les mêmes selon la version de CLDR embarquée par le runtime. Node (côté serveur) produit
 * par exemple `15\u202f000,50\u00a0€` (narrow no-break space) là où certains navigateurs
 * produisent `15\u00a0000,50\u00a0€`. Un seul caractère d'écart entre le HTML du serveur et
 * le premier rendu du client suffit à déclencher :
 *
 *   Error: Hydration failed because the initial UI does not match what was rendered on the server.
 *
 * Solution: on force un espace insécable unique (U+00A0) — rendu identique partout, pas de
 * retour à la ligne au milieu d'un montant — et un signe moins ASCII. Tous les formatteurs
 * de l'app (`lib/formatters.ts`, `lib/utils.ts`) passent par ici ; le garde-fou
 * `scripts/check-hydration.mjs` interdit d'appeler `Intl`/`toLocale*` directement ailleurs.
 */

/** Espaces insécables/ fines produits par les différentes versions de CLDR. */
const INTL_SPACES = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g;
const MINUS_SIGN = /\u2212/g;

export const NBSP = "\u00A0";

/** Remplace toute variation d'espacement Intl par U+00A0 et normalise le signe moins. */
export function normalizeIntlSpaces(value: string): string {
  return value.replace(INTL_SPACES, NBSP).replace(MINUS_SIGN, "-");
}

/** `Intl.NumberFormat(…).format(…)` normalisé — à préférer aux appels directs. */
export function formatNumberIntl(value: number, intlLocale: string, options?: Intl.NumberFormatOptions) {
  return normalizeIntlSpaces(new Intl.NumberFormat(intlLocale, options).format(value));
}

/** `Intl.DateTimeFormat(…).format(…)` normalisé. */
export function formatDateIntl(value: Date, intlLocale: string, options?: Intl.DateTimeFormatOptions) {
  return normalizeIntlSpaces(new Intl.DateTimeFormat(intlLocale, options).format(value));
}
