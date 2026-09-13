/**
 * Détection de locale — source unique, partagée par l'edge (middleware), le serveur (RSC)
 * et le client (hooks).
 *
 * Pourquoi ce fichier existe: `middleware.ts` et `lib/i18n.ts` portaient chacun leur copie de
 * `parseAcceptLanguage` + leur liste de locales. Deux implémentations qui divergent = une locale
 * choisie côté serveur différente de celle choisie côté client → pages traduites dans deux
 * langues et « Hydration failed because the initial UI does not match… ».
 *
 * Aucune dépendance (ni `next/server`, ni DOM) : exécutable en Edge runtime, en Node et en
 * navigateur, donc testable en unit.
 */

export const supportedLocales = ["fr", "en", "nl", "de"] as const;
export type SupportedLocale = (typeof supportedLocales)[number];
export const defaultLocale: SupportedLocale = "fr";

export const LOCALE_COOKIE = "NEXT_LOCALE";
export const LOCALE_STORAGE_KEY = "kredit-locale";
export const LOCALE_COOKIE_MAX_AGE = 31536000; // 1 an
/**
 * Attributs du cookie NEXT_LOCALE — `Secure` dès que le contexte le permet (prod HTTPS),
 * conformément à docs/i18n.md. En http://localhost il doit rester absent, sinon le navigateur
 * le rejette et la préférence de langue ne survit plus au refresh.
 */
export function localeCookieAttrs(secure: boolean): string {
  return `path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/** Version NextResponse.cookies.set() — mêmes attributs, une seule source. */
export const localeCookieOptions = (secure: boolean) =>
  ({ path: "/", maxAge: LOCALE_COOKIE_MAX_AGE, sameSite: "lax", secure } as const);

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === "string" && (supportedLocales as readonly string[]).includes(value.toLowerCase());
}

/** "fr-BE,fr;q=0.9,en-US;q=0.8" → "fr" (q décroissant, base de la balise). */
export function parseAcceptLanguage(header: string | null | undefined): SupportedLocale | null {
  if (!header) return null;
  const parts = header.split(",").map((s) => {
    const [lang, qStr] = s.trim().split(";q=");
    const q = qStr ? Number.parseFloat(qStr) : 1;
    return { base: (lang || "").toLowerCase().split("-")[0], q: Number.isFinite(q) ? q : 0 };
  });
  parts.sort((a, b) => b.q - a.q);
  for (const p of parts) if (isSupportedLocale(p.base)) return p.base as SupportedLocale;
  return null;
}

/** Locale déjà présente en tête de chemin (`/fr/dashboard` → "fr"), sinon null. */
export function localeFromPath(pathname: string): SupportedLocale | null {
  const first = pathname.split("/").filter(Boolean)[0]?.toLowerCase();
  return isSupportedLocale(first) ? (first as SupportedLocale) : null;
}

export function normalizeTag(tag: string | null | undefined): string | undefined {
  return tag?.toLowerCase().split("-")[0];
}

export function cookieFromHeader(cookieHeader: string | null | undefined, name = LOCALE_COOKIE): string | null {
  if (!cookieHeader) return null;
  const m = cookieHeader.match(new RegExp(`(^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[2].trim()) : null;
}

/**
 * Hiérarchie de priorité, identique partout :
 * 1. préférence utilisateur explicite (cookie → JWT → localStorage)
 * 2. langue du navigateur (`navigator.languages` côté client, `Accept-Language` côté serveur)
 * 3. défaut `fr`
 *
 * En cas d'écart, c'est la valeur de l'URL (`pathname`) qui doit primer côté rendu : le
 * middleware redirige déjà vers `/{locale}/…`, et `useLocale()` se base sur le segment
 * `[locale]` pour que serveur et client partent du même point.
 */
export function detectLocale(opts: {
  cookieLocale?: string | null;
  jwtLocale?: string | null;
  storedLocale?: string | null;
  acceptLanguage?: string | null;
  navigatorLanguages?: readonly string[];
  pathname?: string | null;
}): SupportedLocale {
  if (opts.pathname) {
    const fromPath = localeFromPath(opts.pathname);
    if (fromPath) return fromPath;
  }
  const preferred = [opts.cookieLocale, opts.jwtLocale, opts.storedLocale].map(normalizeTag);
  for (const c of preferred) if (isSupportedLocale(c)) return c as SupportedLocale;

  if (opts.navigatorLanguages) {
    for (const nav of opts.navigatorLanguages) {
      const base = normalizeTag(nav);
      if (isSupportedLocale(base)) return base as SupportedLocale;
    }
  }
  const fromHeader = parseAcceptLanguage(opts.acceptLanguage);
  if (fromHeader) return fromHeader;

  return defaultLocale;
}
