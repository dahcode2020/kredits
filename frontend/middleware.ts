import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
// ⚠️ Import exclusif du module de détection (sans dictionnaires JSON) : le middleware tourne en
// Edge runtime. Les locales et `parseAcceptLanguage` viennent de la même source que le client,
// sinon serveur et navigateur peuvent choisir deux locales différentes → mismatch d'hydratation.
import {
  supportedLocales,
  defaultLocale,
  LOCALE_COOKIE,
  localeCookieOptions,
  isSupportedLocale,
  localeFromPath,
  parseAcceptLanguage,
  type SupportedLocale,
} from "@/lib/locale-detection";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/_next") || pathname.startsWith("/icons") || pathname.includes(".") || pathname.startsWith("/api")) {
    return NextResponse.next();
  }

  const cookieLocale = req.cookies.get(LOCALE_COOKIE)?.value;
  const urlLocale = localeFromPath(pathname);

  // Locale déjà dans l'URL : elle fait foi. On la reflète dans le cookie pour les visites suivantes.
  const secure = req.nextUrl.protocol === "https:";

  if (urlLocale) {
    const res = NextResponse.next();
    if (cookieLocale !== urlLocale) {
      res.cookies.set(LOCALE_COOKIE, urlLocale, localeCookieOptions(secure));
    }
    return res;
  }

  // Pas de locale dans le chemin → hiérarchie : 1) cookie 2) Accept-Language 3) défaut
  let locale: SupportedLocale = defaultLocale;
  if (isSupportedLocale(cookieLocale)) locale = cookieLocale as SupportedLocale;
  else {
    const parsed = parseAcceptLanguage(req.headers.get("accept-language"));
    if (parsed) locale = parsed;
  }

  const url = req.nextUrl.clone();
  url.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;
  const res = NextResponse.redirect(url);
  res.cookies.set(LOCALE_COOKIE, locale, localeCookieOptions(secure));
  return res;
}

/**
 * Ce matcher décide quelles requêtes **ne sont pas** traitées par la redirection de locale.
 * Tout ce qui est fichier (`favicon.ico`, assets) ou machinerie Next (`_next/…`, `api/…`) passe
 * sans réécriture. Quand la slice PWA installera un manifeste par locale (`/manifest/nl`),
 * l'exclure ici aussi : sinon le middleware le réécrit en `/nl/manifest/nl` (307) et le navigateur
 * ne récupère aucun manifeste — l'installation échoue silencieusement.
 */
export const config = { matcher: ["/((?!api|_next/static|_next/image|favicon.ico|sw.js|manifest.json|manifest/).*)"] };
