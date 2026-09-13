/**
 * Verrous anti « Hydration failed because the initial UI does not match… ».
 *
 * Ces tests figent les deux invariants dont la violation a cassé l'app :
 *  1. tout formatage `Intl` doit être insensible à la version de CLDR du runtime
 *     (Node émet U+202F, certains navigateurs U+00A0 → un caractère d'écart suffit) ;
 *  2. la détection de locale doit avoir UNE seule source, sinon le serveur et le client
 *     rendent deux langues différentes.
 */
import { normalizeIntlSpaces } from "@/lib/intl";
import { formatCurrency, formatCurrency0, formatDate, formatDateTime, formatNumber, formatPercent, localeToIntl } from "@/lib/formatters";
import { formatEUR, formatEUR2 } from "@/lib/utils";
import { detectLocale, isSupportedLocale, localeFromPath, parseAcceptLanguage, supportedLocales } from "@/lib/locale-detection";
import { locales as i18nLocales, defaultLocale as i18nDefault, parseAcceptLanguage as i18nParse } from "@/lib/i18n";

const SPACE_VARIANTS = /[\u202F\u2007\u2009\u2002\u00A0]/g;
const AMOUNTS = [0, 15000, 1234.56, -42.1, 500000];

describe("Intl — normalisation anti-mismatch serveur/client", () => {
  it("aucun espace fin/insécable non normalisé ne sort des formatteurs", () => {
    for (const locale of supportedLocales) {
      for (const amount of AMOUNTS) {
        for (const out of [
          formatCurrency(amount, locale),
          formatCurrency0(amount, locale),
          formatPercent(0.0399, locale, 2),
          formatNumber(amount, locale, { maximumFractionDigits: 2 }),
        ]) {
          expect(out).toMatch(/^[^\u202F\u2007\u2009\u2002]*$/);
        }
      }
    }
  });

  it("formatEUR / formatEUR2 (lib/utils) sont normalisés aussi", () => {
    // Ils ne prennent plus qu'une locale applicative: le tag Intl n'est plus un paramètre libre.
    for (const amount of AMOUNTS) {
      expect(formatEUR(amount, "fr")).not.toMatch(/\u202F/);
      expect(formatEUR2(amount, "nl")).not.toMatch(/\u202F/);
    }
  });

  it("dates: séparateurs insensibles au runtime + fuseau forcé", () => {
    const d = "2026-12-31T23:30:00Z"; // 31/12 à 00:30 à Bruxelles → test du timeZone explicite
    for (const locale of supportedLocales) {
      expect(formatDate(d, locale)).not.toMatch(SPACE_VARIANTS);
      expect(formatDateTime(d, locale)).not.toMatch(SPACE_VARIANTS);
    }
  });

  it("sortie identique que le runtime emploie U+202F ou U+00A0 (cœur du bug corrigé)", () => {
    const RealNumberFormat = Intl.NumberFormat;
    const reference = AMOUNTS.map((a) => formatCurrency(a, "fr"));
    const referenceEur = AMOUNTS.map((a) => formatEUR2(a, "fr"));

    // Simule un navigateur dont le CLDR utilise déjà U+00A0 comme séparateur de milliers.
    // (proxy sur l'instance : `format` est un getter non inscriptible sur Intl.NumberFormat)
    Intl.NumberFormat = new Proxy(RealNumberFormat, {
      construct(target: any, args: any[]) {
        const inst = new target(...args);
        return new Proxy(inst, {
          get(obj: any, prop) {
            if (prop !== "format") return obj[prop];
            const inner = obj.format.bind(obj);
            return (v: number) => String(inner(v)).replace(/\u202F/g, "\u00A0");
          },
        });
      },
    }) as any;
    try {
      expect(AMOUNTS.map((a) => formatCurrency(a, "fr"))).toEqual(reference);
      expect(AMOUNTS.map((a) => formatEUR2(a, "fr"))).toEqual(referenceEur);
    } finally {
      Intl.NumberFormat = RealNumberFormat;
    }
  });

  it("normalizeIntlSpaces couvre espaces fins, insécables et signe moins Unicode", () => {
    expect(normalizeIntlSpaces("15\u202f000\u00a0€")).toBe("15\u00a0000\u00a0€");
    expect(normalizeIntlSpaces("-42")).toBe("-42");
    expect(normalizeIntlSpaces("\u221242")).toBe("-42");
  });

  it("localeToIntl couvre toutes les locales supportées (jamais de locale implicite)", () => {
    for (const locale of supportedLocales) expect(localeToIntl[locale]).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
  });
});

describe("Détection de locale — une seule source", () => {
  it("lib/i18n et lib/locale-detection exposent les mêmes locales et défaut", () => {
    expect([...i18nLocales]).toEqual([...supportedLocales]);
    expect(i18nDefault).toBe("fr");
  });

  it("parseAcceptLanguage: q décroissant, base de balise, tolérant", () => {
    expect(parseAcceptLanguage("fr-BE,fr;q=0.9,en;q=0.8")).toBe("fr");
    expect(parseAcceptLanguage("en-US,en;q=0.9,nl;q=0.95")).toBe("en"); // en-US sans q ⇒ q=1
    expect(parseAcceptLanguage("fr-CA;q=0.3,de;q=0.9,es;q=0.8")).toBe("de");
    expect(parseAcceptLanguage("de-DE,de;q=1,fr;q=0.1")).toBe("de");
    expect(parseAcceptLanguage("xx-YY")).toBeNull();
    expect(parseAcceptLanguage(null)).toBeNull();
    expect(parseAcceptLanguage("")).toBeNull();
    expect(i18nParse("en-GB,en;q=0.7,fr-CA;q=0.9")).toBe(parseAcceptLanguage("en-GB,en;q=0.7,fr-CA;q=0.9"));
  });

  it("hiérarchie: cookie > navigateur > Accept-Language > défaut", () => {
    expect(detectLocale({ cookieLocale: "nl", navigatorLanguages: ["fr-BE"], acceptLanguage: "de" })).toBe("nl");
    expect(detectLocale({ navigatorLanguages: ["de-DE", "fr"], acceptLanguage: "nl" })).toBe("de");
    expect(detectLocale({ acceptLanguage: "en-GB,en" })).toBe("en");
    expect(detectLocale({})).toBe("fr");
  });

  it("le chemin prime (c'est lui qui est rendu), et rejette une locale inconnue", () => {
    expect(localeFromPath("/en/dashboard")).toBe("en");
    expect(localeFromPath("/dashboard")).toBeNull();
    expect(detectLocale({ pathname: "/nl/x", cookieLocale: "de" })).toBe("nl");
    expect(isSupportedLocale("it")).toBe(false);
    expect(isSupportedLocale("FR")).toBe(true);
  });
});
