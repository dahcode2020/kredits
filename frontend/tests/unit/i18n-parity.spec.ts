/**
 * @jest-environment node
 */
/**
 * Parité des dictionnaires — « aucun texte en dur, tout passe par les clés, dans les 4 langues ».
 *
 * L'ancien dépôt portait 4 clés présentes en français uniquement (un override `fr/fr-BE.json`):
 * `/nl` et `/de` servaient alors du français par repli silencieux. Elles ont été supprimées à la
 * reprise; ce test rend la régression impossible:
 *
 *  1. les quatre dossiers de langue contiennent EXACTEMENT les mêmes fichiers;
 *  2. dans chaque namespace, les quatre langues contiennent EXACTEMENT le même jeu de clés
 *     (aucune clé manquante, aucune clé en trop);
 *  3. aucune valeur vide ou purement numérique (un trou déguisé);
 *  4. le compte total est verrouillé à la baisse: on peut ajouter des clés (dans les 4 langues à
 *     la fois), jamais en perdre. Le brief de reprise annonçait « 706 clés »; le matériel fourni
 *     en aligne 715 — ce test verrouille le réel, pas l'arrondi.
 *
 * Complément de `i18n-keys-usage.spec.ts`: celui-ci vérifie que les clés APPELÉES par le code se
 * résolvent partout; celui-là vérifie les dictionnaires EUX-MÊMES (clés jamais appelées incluses).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const RACINE = join(__dirname, "..", "..");
const LOCALES = ["fr", "en", "nl", "de"] as const;

function chargerLocale(loc: string): { fichiers: string[]; parNs: Map<string, Record<string, string>> } {
  const dir = join(RACINE, "i18n", loc);
  const fichiers = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  const parNs = new Map<string, Record<string, string>>();
  for (const f of fichiers) {
    parNs.set(f.replace(/\.json$/, ""), JSON.parse(readFileSync(join(dir, f), "utf8")));
  }
  return { fichiers, parNs };
}

const data = Object.fromEntries(LOCALES.map((l) => [l, chargerLocale(l)]));

describe("parité des fichiers", () => {
  it("les quatre langues ont exactement les mêmes namespaces", () => {
    for (const loc of LOCALES) {
      expect(data[loc].fichiers).toEqual(data.fr.fichiers);
    }
  });

  it("aucun fichier de traduction orphelin (type « fr-BE.json » de l'ancien dépôt)", () => {
    for (const loc of LOCALES) {
      for (const f of data[loc].fichiers) {
        expect(f).toMatch(/^[a-z]+\.json$/); // pas de tiret, pas de variante régionale
      }
    }
  });
});

describe("parité des clés", () => {
  it("chaque namespace aligne exactement le même jeu de clés dans les quatre langues", () => {
    const cassees: string[] = [];
    for (const ns of data.fr.parNs.keys()) {
      const frCles = Object.keys(data.fr.parNs.get(ns)!).sort();
      for (const loc of ["en", "nl", "de"] as const) {
        const locCles = Object.keys(data[loc].parNs.get(ns) ?? {}).sort();
        if (locCles.join("\u0000") !== frCles.join("\u0000")) {
          const manquees = frCles.filter((k) => !locCles.includes(k));
          const enTrop = locCles.filter((k) => !frCles.includes(k));
          cassees.push(`${ns} [${loc}]${manquees.length ? " manque: " + manquees.join(", ") : ""}${enTrop.length ? " en trop: " + enTrop.join(", ") : ""}`);
        }
      }
    }
    expect(cassees).toEqual([]);
  });

  it("aucune valeur vide (un trou silencieux ferait retomber sur le français)", () => {
    const vides: string[] = [];
    for (const loc of LOCALES) {
      for (const [ns, dict] of data[loc].parNs) {
        for (const [cle, valeur] of Object.entries(dict)) {
          if (typeof valeur !== "string" || !valeur.trim()) vides.push(`${loc}:${ns}:${cle}`);
        }
      }
    }
    expect(vides).toEqual([]);
  });

  it("le total est au moins le compte de la reprise (715 clés × 4 langues)", () => {
    for (const loc of LOCALES) {
      const total = [...data[loc].parNs.values()].reduce((n, d) => n + Object.keys(d).length, 0);
      expect(total).toBeGreaterThanOrEqual(715);
      // Et strictement identique d'une langue à l'autre (conséquence de la parité des clés).
      expect(total).toBe([...data.fr.parNs.values()].reduce((n, d) => n + Object.keys(d).length, 0));
    }
  });
});
