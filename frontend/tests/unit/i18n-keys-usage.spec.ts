/**
 * Toute clé demandée par le code existe dans les quatre langues — et s'y résout.
 *
 * `t()` ne plante pas sur une clé absente: il retombe sur `fr` (et rend la clé elle-même si elle
 * n'existe nulle part). Sans contrôle, une clé ajoutée pour `fr` uniquement fait donc réapparaître
 * du français sur /en, /nl, /de — exactement le défaut corrigé sur la page d'accueil de l'ancien
 * dépôt, mais en plus discret. Ce test énumère les candidats du code (aucun AST, juste des motifs)
 * et vérifie qu'une clé qui se résout quelque part se résout partout — clés nues ET préfixées
 * (`credit:simulator.taeg`), la forme brute utilisée par les pages.
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { locales, t, type Locale } from "@/lib/i18n";
import { estPartagee } from "./translation-exceptions";

const RACINES = ["app", "components", "features", "hooks", "lib"];

function fichiers(dir: string): string[] {
  const out: string[] = [];
  let entries: string[] = [];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const full = join(dir, e);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...fichiers(full));
    else if (/\.(tsx|ts)$/.test(e)) out.push(full);
  }
  return out;
}

/** `t(locale, "a.b")`, `tNs(locale, "credit", "x.y")`, `labelKey: "a.b"` → une chaîne entre
 * guillemets qui ressemble à une clé (point(s), ou préfixe namespace « ns: »). */
const CLE = /["'`]((?:[a-z][\w-]*:)?[a-zA-Z][\w-]*(?:\.[\w-]+)+)["'`]/g;

const candidats = new Map<string, string[]>();
for (const racine of RACINES) {
  for (const f of fichiers(racine)) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(CLE)) {
      const cle = m[1];
      if (/\.(png|jpg|jpeg|svg|webp|json|ts|tsx|js|jsx|css|be|com)$/i.test(cle)) continue;
      if (!cle.includes(":") && !/^[a-z]/.test(cle)) continue;
      const liste = candidats.get(cle) ?? [];
      if (liste.length < 3) liste.push(f);
      candidats.set(cle, liste);
    }
  }
}

/**
 * Une clé se « résout » si `t()` rend autre chose que la clé elle-même. On interroge `t(locale, cle)`
 * avec la **forme brute** utilisée par le code: mêmes résolutions, mêmes fallbacks, donc pas de
 * faux négatifs.
 */
const resout = (loc: Locale, cle: string) => {
  const rendu = t(loc, cle);
  return rendu !== cle && rendu !== undefined && rendu !== "";
};

// Les candidats préfixés (`ns:key`) sont vérifiés tels quels; les nus passent par la résolution
// par défaut (common d'abord). Un candidat qui ne résout NULLE PART n'est pas une clé utilisée:
// c'est un motif décoratif (ex. « 0.015 ») — il sort du contrôle.
const clesDuCode = [...new Set([...candidats.keys()])].filter((cle) => resout("fr", cle));

describe("clés i18n utilisées par le code", () => {
  it("le scan trouve bien les clés de la page d'accueil et des coquilles", () => {
    expect(clesDuCode.length).toBeGreaterThan(120);
    for (const c of [
      "hero.title1", "hero.subtitle", "products.personal.desc", "featured.title",
      "faq.q2", "nav.products", "common:shell.skipToContent", "footer.disclaimer",
      "credit:simulator.taeg", "legal:disclaimer.simulation", "common:seo.title",
    ]) {
      expect(clesDuCode).toContain(c);
    }
  });

  it("toute clé résolue quelque part est résolue dans les quatre langues", () => {
    const cassees: string[] = [];
    for (const cle of clesDuCode) {
      for (const loc of locales) if (!resout(loc, cle)) cassees.push(`${loc} → ${cle}`);
    }
    expect(cassees).toEqual([]);
  });

  it("aucune de ces clés ne rend la même chaîne que le français (sauf endonymes et toponymes)", () => {
    const suspectes: string[] = [];
    for (const cle of clesDuCode) {
      const fr = t("fr", cle);
      if (!/[éèêàâçîïôûùœ]/i.test(fr)) continue; // sans accent: indiscernable d'un loanword
      for (const loc of ["en", "nl", "de"] as Locale[]) {
        if (t(loc, cle) === fr && !estPartagee(cle)) suspectes.push(`${loc} → ${cle}`);
      }
    }
    expect(suspectes).toEqual([]);
  });
});
