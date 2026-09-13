import { Locale } from "./i18n";
import { normalizeIntlSpaces } from "./intl";

/**
 * Point d'entrée UNIQUE du formatage utilisateur (montants, dates, pourcentages).
 *
 * - la locale Intl est toujours dérivée du segment [locale] (jamais `undefined` :
 *   la locale par défaut du runtime diffère entre Node et le navigateur),
 * - le fuseau horaire est forcé à Europe/Brussels (le serveur tourne souvent en UTC),
 * - l'espacement Intl est normalisé (lib/intl.ts) : sans ça, un écart U+202F / U+00A0
 *   entre le HTML du serveur et le rendu du navigateur casse l'hydratation.
 */

// Table des tags Intl déclarée une seule fois dans lib/i18n.ts (avec `Locale`, `localeDir`,
// `openGraphLocale`) et ré-exportée ici : les appels existants `import { localeToIntl } from
// "@/lib/formatters"` continuent de marcher, et il n'existe plus qu'une source.
import { localeToIntl } from "./i18n";
export { localeToIntl };

export const timeZone = "Europe/Brussels";

const NAIVE_DATE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d+))?$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Convertit une valeur de date en instant **indépendant du runtime**.
 *
 * `new Date("2026-09-09 14:22")` (date-time sans décalage) est défini comme temps LOCAL par
 * l'implémentation : la même ligne du DB/mock devient 14:22Z sur un serveur en UTC et 14:22+02
 * dans le navigateur de l'utilisateur → dates différentes serveur/client, donc mismatch
 * d'hydratation sur chaque ligne de liste. On ancre donc explicitement ces valeurs sur UTC, et
 * on le signale en développement : la source (API/postgres) doit envoyer de l'ISO-8601 avec
 * décalage (`2026-09-09T14:22:00+02:00`) ou `Z`.
 *
 * Les dates « jour seul » (`2026-10-01`) restent ISO : interprétées en UTC puis rendues avec
 * `timeZone: Europe/Brussels`, le jour affiché est stable (échéancier, relevé).
 */
export function resolveDate(value: Date | string | number): Date {
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  const v = String(value).trim();
  if (DATE_ONLY.test(v)) return new Date(`${v}T00:00:00Z`);
  const m = NAIVE_DATE.exec(v.replace(" ", "T"));
  if (m) {
    if (typeof process !== "undefined" && process.env?.NODE_ENV === "development" && typeof window === "undefined") {
      console.warn(`[formatters] date sans décalage horaire « ${v} » → ancree en UTC. Envoyer de l'ISO-8601 avec offset (ex. +02:00).`);
    }
    const [, y, mo, d, h, mi, sec, ms] = m;
    return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(sec ?? 0), ms ? +(`0.${ms}`.slice(2).padEnd(3, "0").slice(0, 3)) : 0));
  }
  return new Date(v);
}

// Dates
export function formatDate(date: Date | string | number, locale: Locale, opts?: Intl.DateTimeFormatOptions) {
  const d = resolveDate(date);
  if (Number.isNaN(d.getTime())) return "";
  return normalizeIntlSpaces(new Intl.DateTimeFormat(localeToIntl[locale], { day: "2-digit", month: "2-digit", year: "numeric", timeZone, ...opts }).format(d));
}
export function formatDateTime(date: Date | string | number, locale: Locale) {
  const d = resolveDate(date);
  if (Number.isNaN(d.getTime())) return "";
  return normalizeIntlSpaces(new Intl.DateTimeFormat(localeToIntl[locale], { dateStyle: "medium", timeStyle: "short", timeZone }).format(d));
}
export function formatDateLong(date: Date | string | number, locale: Locale) {
  const d = resolveDate(date);
  if (Number.isNaN(d.getTime())) return "";
  return normalizeIntlSpaces(new Intl.DateTimeFormat(localeToIntl[locale], { dateStyle: "long", timeZone }).format(d));
}
/**
 * Écart humanisé vs `now`. **Fonction pure** : `now` est un paramètre, jamais lu dans la
 * fonction — c'est ce qui la rend utilisable au render (le serveur et le client doivent partir
 * du même instant, sinon le libellé change et l'hydratation échoue).
 */
export function relativeTime(date: Date | string | number, now: Date | string | number, locale: Locale) {
  const d = resolveDate(date);
  const n = resolveDate(now);
  if (Number.isNaN(d.getTime()) || Number.isNaN(n.getTime())) return "";
  const diff = n.getTime() - d.getTime();
  const rtf = () => new Intl.RelativeTimeFormat(localeToIntl[locale], { numeric: "auto" });
  const minutes = Math.round(diff / 60000);
  if (Math.abs(minutes) < 60) return normalizeIntlSpaces(rtf().format(-minutes, "minute"));
  const hours = Math.round(diff / 3600000);
  if (Math.abs(hours) < 24) return normalizeIntlSpaces(rtf().format(-hours, "hour"));
  const days = Math.round(diff / 86400000);
  if (Math.abs(days) < 30) return normalizeIntlSpaces(rtf().format(-days, "day"));
  const months = Math.round(days / 30);
  if (Math.abs(months) < 12) return normalizeIntlSpaces(rtf().format(-months, "month"));
  return normalizeIntlSpaces(rtf().format(-Math.round(days / 365), "year"));
}

/**
 * ⚠️ Utiliser `<RelativeTime>` dans un composant : cette variante lit `Date.now()` au moment de
 * l'appel, donc le texte diffère entre le rendu serveur et le rendu client (mismatch). Réservée
 * aux logs/exports/handlers, hors chemin de rendu.
 */
export function formatRelative(date: Date | string | number, locale: Locale, now: Date | string | number = Date.now()) {
  return relativeTime(date, now, locale);
}

// Numbers
export function formatNumber(n: number, locale: Locale, opts?: Intl.NumberFormatOptions) {
  return normalizeIntlSpaces(new Intl.NumberFormat(localeToIntl[locale], opts).format(n));
}
export function formatCurrency(n: number, locale: Locale, currency: string = "EUR") {
  return normalizeIntlSpaces(new Intl.NumberFormat(localeToIntl[locale], { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n));
}
export function formatCurrency0(n: number, locale: Locale, currency: string = "EUR") {
  return normalizeIntlSpaces(new Intl.NumberFormat(localeToIntl[locale], { style: "currency", currency, maximumFractionDigits: 0 }).format(n));
}
export function formatPercent(n: number, locale: Locale, digits = 1) {
  // n = 0.384 => 38,4%
  return normalizeIntlSpaces(new Intl.NumberFormat(localeToIntl[locale], { style: "percent", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n));
}
/**
 * Montant « de vitrine »: 1 000 000 € devient « 1 M€ », 200 000 € devient « 200 k€ ».
 *
 * Né parce que la carte d'accueil affichait un « 500k€ » écrit à la main, devenu faux dès que le
 * plafond hypothécaire a bougé. Un plafond de vitrine doit être un `format(plafond)`, pas une
 * saisie. Le mantisse passe par `formatNumber` (espace normalisée, virgule par locale), le suffixe
 * k/M est technique et identique dans les quatre langues — comme « € » ou « TAEG ».
 */
export function formatMontantCompact(n: number, locale: Locale): string {
  const absolu = Math.abs(n);
  if (absolu < 1_000) return formatCurrency0(n, locale);
  const [mantisse, suffixe] = absolu >= 1_000_000 ? [n / 1_000_000, " M\u20ac"] : [n / 1_000, " k\u20ac"];
  // Une décimale seulement si elle porte une information: 1 000 000 -> « 1 M€ », pas « 1,0 M€ ».
  const decimales = Math.abs(mantisse % 1) < 1e-9 ? 0 : 1;
  return formatNumber(mantisse, locale, { minimumFractionDigits: decimales, maximumFractionDigits: decimales }) + suffixe;
}
export function formatList(items: string[], locale: Locale, type: "conjunction" | "disjunction" = "conjunction") {
  return normalizeIntlSpaces(new Intl.ListFormat(localeToIntl[locale], { style: "long", type }).format(items));
}

// Address BE: Rue de la Loi 100 bte 5, 1000 Bruxelles, Belgique
export type Address = { street: string; number: string; box?: string; postal: string; city: string; country?: string };
export function formatAddressBE(a: Address, locale: Locale) {
  const countryMap: Record<Locale, string> = { fr: "Belgique", en: "Belgium", nl: "België", de: "Belgien" };
  const boxPart = a.box ? (locale === "nl" ? ` bus ${a.box}` : locale === "de" ? ` Fach ${a.box}` : ` bte ${a.box}`) : "";
  const country = a.country ?? countryMap[locale];
  return `${a.street} ${a.number}${boxPart}, ${a.postal} ${a.city}, ${country}`;
}

// Phone BE
import { parsePhoneNumberFromString } from "libphonenumber-js";
export function formatPhoneBE(raw: string, locale: Locale = "fr") {
  try {
    const pn = parsePhoneNumberFromString(raw, "BE");
    if (!pn || !pn.isValid()) return raw;
    return pn.formatInternational(); // +32 470 12 34 56
  } catch { return raw; }
}
export function isValidPhoneBE(raw: string) {
  const pn = parsePhoneNumberFromString(raw, "BE");
  return !!pn?.isValid();
}
export function formatPhoneNational(raw: string) {
  const pn = parsePhoneNumberFromString(raw, "BE");
  return pn?.formatNational() ?? raw; // 0470 12 34 56
}
