// KREDIT i18n — hiérarchie 1) préférence utilisateur 2) navigateur 3) défaut + persistance + ICU.
// Structure: frontend/i18n/{fr,en,nl,de}/*.json — 11 namespaces × 4 langues, 715 clés alignées.
//
// Reprendre sans héritage: l'ancien dépôt portait un override `fr/fr-BE.json` de 4 clés présentes
// en français uniquement (address.format, common.nav.home, credit.simulator.legal,
// legal.disclaimer.simulation). Le brief de reprise les disait « à traduire ou supprimer »: elles
// sont supprimées, donc la parité des 4 langues est STRUCTURELLE — verrouillée par
// tests/unit/i18n-parity.spec.ts et contrôlée en CI.
import frCommon from "@/i18n/fr/common.json";
import enCommon from "@/i18n/en/common.json";
import nlCommon from "@/i18n/nl/common.json";
import deCommon from "@/i18n/de/common.json";
import frAuth from "@/i18n/fr/auth.json";
import enAuth from "@/i18n/en/auth.json";
import nlAuth from "@/i18n/nl/auth.json";
import deAuth from "@/i18n/de/auth.json";
import frDashboard from "@/i18n/fr/dashboard.json";
import enDashboard from "@/i18n/en/dashboard.json";
import nlDashboard from "@/i18n/nl/dashboard.json";
import deDashboard from "@/i18n/de/dashboard.json";
import frCredit from "@/i18n/fr/credit.json";
import enCredit from "@/i18n/en/credit.json";
import nlCredit from "@/i18n/nl/credit.json";
import deCredit from "@/i18n/de/credit.json";
import frInvestment from "@/i18n/fr/investment.json";
import enInvestment from "@/i18n/en/investment.json";
import nlInvestment from "@/i18n/nl/investment.json";
import deInvestment from "@/i18n/de/investment.json";
import frPayments from "@/i18n/fr/payments.json";
import enPayments from "@/i18n/en/payments.json";
import nlPayments from "@/i18n/nl/payments.json";
import dePayments from "@/i18n/de/payments.json";
import frDocuments from "@/i18n/fr/documents.json";
import enDocuments from "@/i18n/en/documents.json";
import nlDocuments from "@/i18n/nl/documents.json";
import deDocuments from "@/i18n/de/documents.json";
import frNotifications from "@/i18n/fr/notifications.json";
import enNotifications from "@/i18n/en/notifications.json";
import nlNotifications from "@/i18n/nl/notifications.json";
import deNotifications from "@/i18n/de/notifications.json";
import frAdmin from "@/i18n/fr/admin.json";
import enAdmin from "@/i18n/en/admin.json";
import nlAdmin from "@/i18n/nl/admin.json";
import deAdmin from "@/i18n/de/admin.json";
import frErrors from "@/i18n/fr/errors.json";
import enErrors from "@/i18n/en/errors.json";
import nlErrors from "@/i18n/nl/errors.json";
import deErrors from "@/i18n/de/errors.json";
import frLegal from "@/i18n/fr/legal.json";
import enLegal from "@/i18n/en/legal.json";
import nlLegal from "@/i18n/nl/legal.json";
import deLegal from "@/i18n/de/legal.json";

// Sources uniques: locales / défaut / cookie / storage viennent de lib/locale-detection,
// utilisé aussi par middleware.ts et les hooks. Deux listes qui divergent = deux locales
// choisies (serveur vs client) = mismatch d'hydratation sur toute la page.
import {
  supportedLocales,
  defaultLocale as sharedDefaultLocale,
  parseAcceptLanguage as sharedParseAcceptLanguage,
  detectLocale as sharedDetectLocale,
  cookieFromHeader,
  isSupportedLocale as sharedIsSupportedLocale,
  LOCALE_COOKIE,
  LOCALE_STORAGE_KEY,
  LOCALE_COOKIE_MAX_AGE,
  localeCookieAttrs,
  type SupportedLocale,
} from "./locale-detection";

export const locales = supportedLocales;
export type Locale = SupportedLocale;
export const defaultLocale: Locale = sharedDefaultLocale;
/**
 * Garde de validation d'un tag de locale. Ré-exportée ici (et non importée du module voisin par les
 * pages) pour que `@/lib/i18n` reste la façade unique: une page qui accepte n'importe quelle valeur
 * de `params.locale` retombe sur le français en dur, et le « fallback fr » écrit dans le composant
 * est le jour où un lien `/xx/...` sert une langue au hasard.
 */
export const isSupportedLocale = (value: unknown): value is Locale => sharedIsSupportedLocale(value as string);

export const namespaces = ["common", "auth", "dashboard", "credit", "investment", "payments", "documents", "notifications", "admin", "errors", "legal"] as const;
export type Namespace = typeof namespaces[number];

type Dict = Record<string, string>;

// Une table par locale et par namespace — le seul endroit où les dictionnaires sont assemblés.
const raw: Record<Locale, Record<Namespace, Dict>> = {
  fr: {
    common: frCommon as Dict, auth: frAuth as Dict, dashboard: frDashboard as Dict,
    credit: frCredit as Dict, investment: frInvestment as Dict, payments: frPayments as Dict,
    documents: frDocuments as Dict, notifications: frNotifications as Dict, admin: frAdmin as Dict,
    errors: frErrors as Dict, legal: frLegal as Dict,
  },
  en: {
    common: enCommon as Dict, auth: enAuth as Dict, dashboard: enDashboard as Dict,
    credit: enCredit as Dict, investment: enInvestment as Dict, payments: enPayments as Dict,
    documents: enDocuments as Dict, notifications: enNotifications as Dict, admin: enAdmin as Dict,
    errors: enErrors as Dict, legal: enLegal as Dict,
  },
  nl: {
    common: nlCommon as Dict, auth: nlAuth as Dict, dashboard: nlDashboard as Dict,
    credit: nlCredit as Dict, investment: nlInvestment as Dict, payments: nlPayments as Dict,
    documents: nlDocuments as Dict, notifications: nlNotifications as Dict, admin: nlAdmin as Dict,
    errors: nlErrors as Dict, legal: nlLegal as Dict,
  },
  de: {
    common: deCommon as Dict, auth: deAuth as Dict, dashboard: deDashboard as Dict,
    credit: deCredit as Dict, investment: deInvestment as Dict, payments: dePayments as Dict,
    documents: deDocuments as Dict, notifications: deNotifications as Dict, admin: deAdmin as Dict,
    errors: deErrors as Dict, legal: deLegal as Dict,
  },
};

// Index plat « ns:key » par locale; les clés de `common` sont aussi accessibles nues
// (les appels historiques `t(locale, "hero.title1")`).
export const translations: Record<Locale, Record<string, string>> = {
  fr: flatten("fr"), en: flatten("en"), nl: flatten("nl"), de: flatten("de"),
};

function flatten(locale: Locale): Record<string, string> {
  const out: Record<string, string> = {};
  for (const ns of namespaces) {
    for (const [k, v] of Object.entries(raw[locale][ns])) {
      out[`${ns}:${k}`] = v;
      if (ns === "common" && !out[k]) out[k] = v;
    }
  }
  return out;
}

// --- Interpolation ICU-like: {var} et {count, plural, one {…} other {…}} ---
function interpolate(template: string, vars: Record<string, any> | undefined, locale: Locale): string {
  if (!vars) return template;
  let out = template;
  const pluralRe = /\{(\w+),\s*plural,\s*one\s*\{([^}]*)\}\s*other\s*\{([^}]*)\}\}/g;
  out = out.replace(pluralRe, (_, varName: string, one: string, other: string) => {
    const n = Number(vars[varName] ?? 0);
    const rule = new Intl.PluralRules(localeToIntl[locale] as any).select(n);
    const chosen = rule === "one" ? one : other;
    return chosen.replace("#", String(n));
  });
  out = out.replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] !== undefined ? String(vars[k]) : `{${k}}`));
  return out;
}

/**
 * **Source unique** des tags Intl du marché belge. `lib/formatters.ts` la ré-exporte (une copie
 * par module = la divergence qui a déjà cassé la détection de langue, docs/hydration.md règle 8).
 * Aucun composant ne doit écrire un tag en dur: les formatteurs prennent la locale applicative
 * (`fr|en|nl|de`) et résolvent ce tag eux-mêmes.
 */
export const localeToIntl: Record<Locale, string> = { fr: "fr-BE", en: "en-BE", nl: "nl-BE", de: "de-BE" };

/**
 * `og:locale` / `og:locale:alternate`: l'énumération du protocole Open Graph est fermée, elle
 * n'accepte ni `fr_BE` (rejeté par le parseur au scrape) ni `en_BE`/`de_BE`. On bascule sur la
 * variante nationale reconnue, sauf `nl_BE` qui figure dans la liste. Le tag n'est jamais écrit
 * dans une page: il sort de cette table (voir `app/[locale]/layout.tsx`).
 */
export const openGraphLocale: Record<Locale, string> = { fr: "fr_FR", en: "en_GB", nl: "nl_BE", de: "de_DE" };

// Direction par locale — à compléter si une locale RTL (ar, he…) est ajoutée.
export const localeDir: Record<Locale, "ltr" | "rtl"> = { fr: "ltr", en: "ltr", nl: "ltr", de: "ltr" };

/**
 * Sigle du règlement européen sur les données, par marché: RGPD en français, GDPR en anglais,
 * AVG en néerlandais, DSGVO en allemand. C'est une donnée de langue (pas de la copie d'écran):
 * sa table vit ici, à côté des autres tables de locale — le composant qui l'affiche ne l'écrit
 * jamais en dur (« RGPD » affiché tel quel sur /de était exactement la fuite reprochée).
 */
export const gdprAcronym: Record<Locale, string> = { fr: "RGPD", en: "GDPR", nl: "AVG", de: "DSGVO" };

/** Nom vernaculaire de la langue, tel qu'affiché par un locuteur de cette langue (sélecteur). */
export const localeLabels: Record<Locale, string> = { fr: "Français", en: "English", nl: "Nederlands", de: "Deutsch" };

/**
 * Étiquette technique montrée à côté du nom de langue (sélecteur du header). **Dérivée** de
 * `localeToIntl`: recopier « FR-BE » dans un composant, c'est exactement la table parallèle qui
 * finit par diverger de la table réelle.
 */
export const localeTagLabel: Record<Locale, string> = Object.fromEntries(
  locales.map((l) => [l, localeToIntl[l].toUpperCase()]),
) as Record<Locale, string>;

/**
 * Résolution d'une clé: « ns:key » ou clé nue (cherchée dans `common` puis dans les autres
 * namespaces). Chaîne de repli: locale demandée → français → la clé elle-même. Le repli sur `fr`
 * est voulu: une clé manquante doit se voir (test de parité en CI), pas produire un trou.
 */
export function t(locale: Locale, key: string, vars?: Record<string, any>): string {
  let template: string | undefined;
  if (key.includes(":")) {
    template = translations[locale]?.[key] ?? translations[defaultLocale]?.[key];
  } else {
    template =
      translations[locale]?.[key] ??
      translations[locale]?.[`common:${key}`] ??
      translations[defaultLocale]?.[key] ??
      translations[defaultLocale]?.[`common:${key}`];
    if (!template) {
      for (const ns of namespaces) {
        const cand = translations[locale]?.[`${ns}:${key}`];
        if (cand) { template = cand; break; }
      }
    }
  }
  if (!template) {
    if (typeof window !== "undefined") console.warn(`[i18n] missing key "${key}" for locale "${locale}"`);
    return key;
  }
  return interpolate(template, vars, locale);
}

// Variante namespace explicite: tNs(locale, 'credit', 'simulator.title', {amount})
export function tNs(locale: Locale, ns: Namespace, key: string, vars?: Record<string, any>) {
  return t(locale, `${ns}:${key}`, vars);
}

// --- Détection (implémentation partagée avec middleware.ts) ---
export function parseAcceptLanguage(header: string | null | undefined): Locale | null {
  return sharedParseAcceptLanguage(header);
}

export function detectLocale(opts: {
  cookieLocale?: string | null,
  jwtLocale?: string | null,
  storedLocale?: string | null,
  acceptLanguage?: string | null,
  navigatorLanguages?: readonly string[],
  pathname?: string | null,
}): Locale {
  return sharedDetectLocale(opts);
}

// --- Persistance ---
export const STORAGE_KEY = LOCALE_STORAGE_KEY;
export const COOKIE_NAME = LOCALE_COOKIE;
export const COOKIE_MAX_AGE = LOCALE_COOKIE_MAX_AGE; // 1 an

// ⚠️ À appeler uniquement dans un effect / un handler (jamais pendant un render):
// ces API sont absentes du serveur et peuvent lever (Safari privé, cookies désactivés).
export function getPersistedLocale(): Locale | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && (locales as readonly string[]).includes(stored)) return stored as Locale;
  } catch {} // Storage refusé (navigation privée / bloqué)
  try {
    const fromCookie = cookieFromHeader(document.cookie, COOKIE_NAME);
    if (isSupportedLocale(fromCookie)) return fromCookie as Locale;
  } catch {}
  return null;
}

export function setPersistedLocale(locale: Locale) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {}
  try {
    document.cookie = `${COOKIE_NAME}=${locale}; ${localeCookieAttrs(window.location.protocol === "https:")}`;
  } catch {}
}
