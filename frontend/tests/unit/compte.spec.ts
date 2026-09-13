/**
 * @jest-environment node
 */
/**
 * Dashboard (slice 5) — partie pure : l'échéance projetée tombe le 1er du mois suivant, la
 * moyenne d'aucune mensualité est « — » (null), et la courbe ne fait que transposer
 * l'échéancier du moteur (mois, restant dû), sans rien inventer.
 */
import { moyenne, pointsCourbe, prochaineEcheance } from "@/lib/compte";

describe("prochaineEcheance", () => {
  it("premier jour du mois suivant, en UTC", () => {
    expect(prochaineEcheance(new Date(Date.UTC(2026, 8, 13))).toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(prochaineEcheance(new Date(Date.UTC(2026, 11, 31))).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("moyenne", () => {
  it("null sans mensualité, sinon la moyenne", () => {
    expect(moyenne([])).toBeNull();
    expect(moyenne([300, 500])).toBe(400);
  });
});

describe("pointsCourbe", () => {
  it("transpose l'échéancier tel quel", () => {
    expect(pointsCourbe([{ month: 1, balance: 900 }, { month: 2, balance: 0 }]))
      .toEqual([[1, 900], [2, 0]]);
  });
});
