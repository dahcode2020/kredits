/**
 * @jest-environment node
 */
/**
 * Verrous du simulateur (slice 2) — promis par le commentaire de credit-tiers.spec.ts, posés ici
 * en même temps que la route, jamais avant.
 *
 * 1. L'échéancier est un vrai amortissement français : une ligne par mois, mensualité constante,
 *    le capital remboursé somme au montant emprunté (au centime près de l'arrondi ligne à ligne),
 *    le solde final est zéro, les intérêts somment au total annoncé.
 * 2. L'UI ne peut pas afficher une alerte ou un document que les dictionnaires ne portent pas dans
 *    les QUATRE langues : chaque code émis par le moteur a sa clé `credit:simulator.warning.*` /
 *    `credit:documents.*` (le composant passe par des tables de clés littérales, ce test couvre la
 *    dynamique).
 */
import {
  DOCUMENT_CODES, PRODUITS, PRODUCT_TYPES, SIMULATION_WARNINGS, simulateCredit,
} from "@/lib/credit-engine";
import { locales, translations } from "@/lib/i18n";

function simuler(code: (typeof PRODUCT_TYPES)[number]) {
  const p = PRODUITS[code];
  const montant = Math.min(p.min + p.pas * 4, p.max);
  const resultat = simulateCredit({
    amount: montant,
    termMonths: p.minTerm,
    monthlyIncome: 4_000,
    monthlyCharges: 800,
    incomeType: "SALARY",
    employmentStatus: "CDI",
    loanPurpose: "CONSUMPTION",
    existingCreditsMonthly: 0,
    country: "BE",
    productType: code,
  });
  return { montant, resultat };
}

describe("échéancier — méthode française", () => {
  for (const code of PRODUCT_TYPES) {
    it(`${code}: une ligne par mois, mensualité constante, capital sommé, solde final zéro`, () => {
      const { montant, resultat } = simuler(code);
      const n = PRODUITS[code].minTerm;
      const { schedule } = resultat.simulation;
      expect(schedule).toHaveLength(n);
      expect(new Set(schedule.map((l) => l.payment)).size).toBe(1);
      const capital = schedule.reduce((s, l) => s + l.principal, 0);
      expect(Math.abs(capital - montant)).toBeLessThanOrEqual(n * 0.01 + 0.01);
      expect(schedule[n - 1].balance).toBe(0);
    });
  }

  it("les intérêts de chaque ligne somment au total d'intérêts annoncé", () => {
    const { resultat } = simuler("PERSONAL");
    const interets = resultat.simulation.schedule.reduce((s, l) => s + l.interest, 0);
    expect(Math.abs(interets - resultat.simulation.totalInterest)).toBeLessThanOrEqual(
      resultat.simulation.schedule.length * 0.01 + 0.01,
    );
  });
});

describe("alertes et documents — chaque code du moteur a sa clé dans les 4 langues", () => {
  for (const code of SIMULATION_WARNINGS) {
    it(`credit:simulator.warning.${code}`, () => {
      for (const l of locales) {
        expect(translations[l][`credit:simulator.warning.${code}`]).toBeDefined();
      }
    });
  }
  for (const code of DOCUMENT_CODES) {
    it(`credit:documents.${code}`, () => {
      for (const l of locales) {
        expect(translations[l][`credit:documents.${code}`]).toBeDefined();
      }
    });
  }
  it("le simulateur n'émet que des codes prévus", () => {
    for (const code of PRODUCT_TYPES) {
      const { resultat } = simuler(code);
      for (const w of resultat.warnings) expect(SIMULATION_WARNINGS).toContain(w.code);
      for (const d of resultat.requiredDocuments) expect(DOCUMENT_CODES as readonly string[]).toContain(d.code);
    }
  });
});
