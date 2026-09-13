/**
 * @jest-environment node
 */
/**
 * Pont simulateur → demande (slice 3) : l'état voyage dans l'URL, donc une URL bricolée est une
 * attaque comme une autre. Verrous :
 * - réciproque exacte query ⇄ état valide ;
 * - toute valeur hors table (produit inconnu, montant hors bornes ou non multiple du pas, durée
 *   hors bornes, énumération inventée, négatifs) est ramenée DANS la table — jamais rendue telle
 *   quelle ;
 * - le format de référence locale est stable.
 */
import {
  DEFAUT_SIM, etatDepuisQuery, montantValide, nouvelleReference, queryDepuisEtat,
} from "@/lib/application";
import { PRODUITS } from "@/lib/credit-engine";

const relire = (e: Parameters<typeof queryDepuisEtat>[0]) =>
  etatDepuisQuery(Object.fromEntries(new URLSearchParams(queryDepuisEtat(e))));

describe("query ⇄ état", () => {
  it("aller-retour exact sur un état valide", () => {
    const e = { ...DEFAUT_SIM, product: "MORTGAGE" as const, amount: 250_000, term: 240 };
    expect(relire(e)).toEqual(e);
  });

  it("query vide → défaut de l'exemple", () => {
    expect(etatDepuisQuery({})).toEqual(DEFAUT_SIM);
  });
});

describe("une URL bricolée reste dans la grille", () => {
  it("produit inconnu → PERSONAL", () => {
    expect(etatDepuisQuery({ p: "YACHT" }).product).toBe("PERSONAL");
  });
  it("montant sous le plancher investissement → plancher, arrondi au pas", () => {
    expect(etatDepuisQuery({ p: "INVESTMENT", a: "100" }).amount).toBe(PRODUITS.INVESTMENT.min);
  });
  it("montant non multiple du pas → arrondi au pas", () => {
    expect(montantValide(15_100, "PERSONAL")).toBe(15_000);
    expect(montantValide(15_200, "PERSONAL")).toBe(15_250);
  });
  it("montant au-delà du plafond → plafond", () => {
    expect(etatDepuisQuery({ p: "PERSONAL", a: "999999999" }).amount).toBe(PRODUITS.PERSONAL.max);
  });
  it("durée hors bornes → bornes", () => {
    expect(etatDepuisQuery({ p: "MORTGAGE", t: "12" }).term).toBe(PRODUITS.MORTGAGE.minTerm);
    expect(etatDepuisQuery({ p: "MORTGAGE", t: "9999" }).term).toBe(PRODUITS.MORTGAGE.maxTerm);
  });
  it("énumérations inventées → défauts", () => {
    const e = etatDepuisQuery({ it: "LOTTERY", em: "PIRATE", lp: "YACHT" });
    expect(e.incomeType).toBe(DEFAUT_SIM.incomeType);
    expect(e.employment).toBe(DEFAUT_SIM.employment);
    expect(e.purpose).toBe(DEFAUT_SIM.purpose);
  });
  it("négatifs → planchers, non-numériques → défauts", () => {
    const e = etatDepuisQuery({ inc: "-500", chg: "abc", ex: "-1" });
    expect(e.income).toBe(0);
    expect(e.charges).toBe(DEFAUT_SIM.charges);
    expect(e.existing).toBe(0);
  });
});

describe("référence locale", () => {
  it("format stable KRD-année-empreinte", () => {
    const r = nouvelleReference(new Date(Date.UTC(2026, 8, 13)));
    expect(r).toMatch(/^KRD-2026-[0-9A-Z]+$/);
  });
});
