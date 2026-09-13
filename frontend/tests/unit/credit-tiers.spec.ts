/**
 * @jest-environment node
 */
/**
 * Grille commerciale BE du 12/09/2026 — verrous.
 *
 * Paliers de taux : 1 500–50 000 € à 2,50 % • 50 001–500 000 € à 1,90 % • 500 001–1 000 000 € à
 * 1,80 % • au-delà de 1 000 000 € à 1,50 %.
 * Bornes par produit : personnel 1 500–200 000 € • hypothécaire 20 000–1 000 000 € • professionnel
 * 20 000–3 000 000 € • investissement 200 000–30 000 000 €.
 *
 * Ce que teste vraiment ce fichier, au-delà des chiffres : que ces nombres n'existent **qu'à un
 * seul endroit** (`rate_be/grille.json`, que frontend/lib/credit-engine.ts importe). Dans l'ancien
 * dépôt ils vivaient en six
 * exemplaires (moteur frontend, grille backend, deux `SimulationService`, tuiles de l'accueil,
 * descriptions de dictionnaires) — et chaque changement de grille ratait la moitié des affichages.
 * D'où les règles « aucune chaîne chiffrée dans l'UI » et « les descriptions ne portent plus de
 * chiffre », écrites comme des tests et pas comme une convention.
 *
 * Périmètre slice 1 : les verrous propres au simulateur (échéancier, codes d'alertes et de
 * documents) vivent depuis la slice 2 dans tests/unit/simulator-schedule.spec.ts — ajoutés en même
 * temps que la route, jamais avant, jamais sur des fichiers qui n'existent pas encore.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EFFECTIF_DEPUIS, GRILLE, GRILLE_VERSION, HISTORIQUE_GRILLES, PALIERS_TAUX, PRODUITS,
  PRODUCT_TYPES, chainonValide, findRateRule, grilleValideA, palierPour, reglesDeEntree,
  simulateCredit, tauxMiniProduit, tauxPour,
} from "@/lib/credit-engine";

const FRONT = join(__dirname, "..", "..");
const DEPOT = join(FRONT, "..");
const lu = (rel: string) => readFileSync(join(DEPOT, rel), "utf8");

const base = {
  monthlyIncome: 5_000, monthlyCharges: 800, incomeType: "SALARY", employmentStatus: "CDI",
  loanPurpose: "VEHICLE", existingCreditsMonthly: 0, country: "BE",
} as const;

describe("paliers de taux", () => {
  it("les quatre paliers, dans l'ordre et aux bornes du brief", () => {
    expect(PALIERS_TAUX.map((p) => [p.min, p.max === Infinity ? null : p.max, p.taux])).toEqual([
      [1500, 50000, 0.025],
      [50001, 500000, 0.019],
      [500001, 1000000, 0.018],
      [1000001, null, 0.015],
    ]);
  });

  it.each([
    [1_500, 0.025], [49_999, 0.025], [50_000, 0.025],
    [50_001, 0.019], [500_000, 0.019],
    [500_001, 0.018], [1_000_000, 0.018],
    [1_000_001, 0.015], [30_000_000, 0.015],
  ])("%i € → taux %f", (montant, attendu) => {
    expect(tauxPour(montant)).toBe(attendu);
  });

  it("en dessous de 1 500 €, il n'y a pas de taux — pas de taux par défaut", () => {
    expect(tauxPour(1_499)).toBeNull();
    expect(palierPour(0)).toBeNull();
  });

  it("les paliers sont des entiers contigus: un montant à virgule ne tombe dans aucun palier", () => {
    // Contrat assumé (et non accident): le curseur du simulateur débite au pas du produit, donc il
    // ne produit que des entiers. Si un import de données amène un 50 000,50 €, c'est une erreur,
    // pas un arrondi silencieux vers 2,50 % ou vers 1,90 %.
    expect(tauxPour(50_000.5)).toBeNull();
  });
});

describe("bornes produits", () => {
  it.each([
    ["PERSONAL", 1_500, 200_000],
    ["MORTGAGE", 20_000, 1_000_000],
    ["BUSINESS", 20_000, 3_000_000],
    ["INVESTMENT", 200_000, 30_000_000],
  ] as const)("%s : %i € à %i €", (code, min, max) => {
    expect(PRODUITS[code].min).toBe(min);
    expect(PRODUITS[code].max).toBe(max);
  });

  it("les quatre produits du brief sont bien les quatre onglets", () => {
    expect([...PRODUCT_TYPES]).toEqual(["PERSONAL", "MORTGAGE", "BUSINESS", "INVESTMENT"]);
  });

  it("chaque produit a un label dans les quatre dictionnaires (clé = code)", () => {
    for (const loc of ["fr", "en", "nl", "de"]) {
      const d = JSON.parse(lu(`frontend/i18n/${loc}/credit.json`)) as Record<string, string>;
      for (const code of PRODUCT_TYPES) {
        expect(d[`simulator.tab.${code}`]).toBeTruthy();
      }
    }
  });

  it("hors fourchette du produit: aucune règle, donc pas de prix inventé", () => {
    expect(findRateRule("BE", "PERSONAL", 250_000, 84)).toBeNull();
    expect(findRateRule("BE", "INVESTMENT", 100_000, 60)).toBeNull();
    expect(findRateRule("BE", "MORTGAGE", 20_000, 12)).toBeNull(); // sous sa durée minimale
    expect(() => simulateCredit({ amount: 250_000, termMonths: 84, ...base, productType: "PERSONAL" } as any)).toThrow(/Aucune grille/);
  });

  it("le haut de chaque fourchette garde son propre identifiant de règle", () => {
    expect(findRateRule("BE", "PERSONAL", 50_001, 84)!.id).toBe("rate_BE_PERSONAL_50001_200000");
    expect(findRateRule("BE", "INVESTMENT", 30_000_000, 240)!.id).toBe("rate_BE_INVESTMENT_1000001_30000000");
    expect(findRateRule("BE", "MORTGAGE", 800_000, 120)!.baseRate).toBe(0.018);
  });
});

describe("calcul", () => {
  it("15 000 € / 48 mois au 1er palier — valeurs mesurées, pas arrondies à la main", () => {
    const out = simulateCredit({ amount: 15_000, termMonths: 48, ...base, productType: "PERSONAL" } as any);
    expect(out.simulation.monthlyPayment).toBeCloseTo(328.71, 2);
    expect(out.simulation.annualRate).toBe(0.025);
    // TAEG = taux + frais de dossier lissés: 150 € de frais (1 % plafonné) sur 4 ans à 2,50 %.
    expect(out.simulation.taeg).toBeCloseTo(0.0275, 4);
    expect(out.simulation.fees.file).toBe(150);
    expect(out.simulation.totalCost).toBeCloseTo(15_928.1, 1);
    expect(out.simulation.meta.rateRuleId).toBe("rate_BE_PERSONAL_1500_50000");
    expect(out.simulation.schedule).toHaveLength(48);
  });

  it("un emprunt de 2 M€ en investissement est simulable et au dernier palier", () => {
    const out = simulateCredit({
      amount: 2_000_000, termMonths: 120, monthlyIncome: 40_000, monthlyCharges: 3_000,
      incomeType: "SALARY", employmentStatus: "CDI", loanPurpose: "OTHER", existingCreditsMonthly: 0,
      country: "BE", productType: "INVESTMENT",
    } as any);
    expect(out.simulation.annualRate).toBe(0.015);
    expect(out.eligibility.isEligible).toBe(true);
    expect(out.requiredDocuments.map((d: any) => d.code)).toContain("BANK_STATEMENTS_3M");
  });

  it("le « dès » d'un produit est bien le taux de son dernier palier atteignable", () => {
    expect(tauxMiniProduit("PERSONAL")).toBe(0.019); // plafonné à 200 000 € : le 1,50 % lui est hors de portée
    expect(tauxMiniProduit("MORTGAGE")).toBe(0.018);
    expect(tauxMiniProduit("INVESTMENT")).toBe(0.015);
  });

  it("l'effet de bord du brief: sur 1 500 € / 12 mois, les 75 € de frais minimum font un TAEG de 7,50 %", () => {
    // C'est LE chiffre que la page d'accueil doit montrer: un « dès 2,50 % » qui cache que le plus
    // petit crédit possible coûte 7,50 % TAEG est une promesse fausse. Verrouillé ici pour que ni
    // la table (frais minimum), ni le moteur (formule TAEG), ni l'écran (qui lit les deux) ne
    // puissent le faire disparaître.
    const out = simulateCredit({
      amount: PRODUITS.PERSONAL.min, termMonths: PRODUITS.PERSONAL.minTerm,
      ...base, productType: "PERSONAL",
    } as any);
    expect(out.simulation.annualRate).toBe(0.025);
    expect(out.simulation.fees.file).toBe(75); // 1 % de 1 500 € = 15 € → relevé au minimum de 75 €
    expect(out.simulation.taeg).toBeCloseTo(0.075, 4);
  });
});

describe("une seule source des chiffres (slice 1)", () => {
  // Les écrans qui existent à ce stade: la page d'accueil et ses sections. La règle: AUCUN
  // pourcentage écrit à la main dans ce qui est affiché — tout taux sort de la table.
  const fichiersUI = [
    "frontend/app/[locale]/page.tsx",
    "frontend/components/home/Hero.tsx",
    "frontend/components/home/HeroCard.tsx",
    "frontend/components/home/ProductSection.tsx",
    "frontend/components/home/AboutSection.tsx",
    "frontend/components/home/ProcessSection.tsx",
    "frontend/components/home/ServicesSection.tsx",
    "frontend/components/home/TestimonialsSection.tsx",
    "frontend/components/home/FaqSection.tsx",
  ];

  it.each(fichiersUI)("%s n'affiche plus de pourcentage écrit à la main", (rel) => {
    const src = lu(rel);
    // Un taux en dur dans le JSX est exactement ce qui a rendu l'interface menteuse après chaque
    // changement de grille. Les pourcentages autorisés sont ceux des commentaires et des tests.
    const horsCommentaires = src
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:"'\\])\/\/[^\n]*/g, "$1 ");
    const literals = [...horsCommentaires.matchAll(/[»"'>]\s*[^<>{}]*?\b\d{1,2}[.,]\d{2}\s?%/g)].map((m) => m[0].trim());
    expect(literals).toEqual([]);
  });

  it("les descriptions de produits ne portent plus de chiffre", () => {
    for (const loc of ["fr", "en", "nl", "de"]) {
      const d = JSON.parse(lu(`frontend/i18n/${loc}/common.json`)) as Record<string, string>;
      for (const code of ["personal", "mortgage", "business"]) {
        expect(d["products." + code + ".desc"]).not.toMatch(/\d/);
      }
    }
  });

});

describe("miroir backend — rate_be/grille.json (slice 7)", () => {
  // La table partagée : le moteur frontend la lit, le futur backend lira le même fichier.
  // Un test qui comparerait un backend absent se mentirait — alors on verrouille ce qui existe :
  // tout ce que le moteur expose sort de cette table, et la table est scellée par une chaîne de hashes.
  const grille = JSON.parse(lu("rate_be/grille.json")) as {
    schema: string; pays: string; devise: string;
    historique: Array<{
      version: string; effectif_du: string; effectif_au: string | null; note: string;
      paliers_taux: Array<{ min: number; max: number | null; taux: number }>;
      produits: Record<string, { min: number; max: number; minTerm: number; maxTerm: number; pas: number; frais: { filePct: number; fileMin: number; fileMax: number } }>;
      hash_precedent: string | null; hash: string;
    }>;
  };
  const ouverte = grille.historique[grille.historique.length - 1];

  it("PALIERS_TAUX est exactement l'entrée ouverte de la table (Infinity = palier ouvert)", () => {
    expect(PALIERS_TAUX.map((p) => [p.min, p.max === Infinity ? null : p.max, p.taux]))
      .toEqual(ouverte.paliers_taux.map((p) => [p.min, p.max, p.taux]));
  });

  it("PRODUITS est exactement l'entrée ouverte de la table (le code est ajouté, rien d'autre)", () => {
    for (const code of Object.keys(ouverte.produits)) {
      const p = PRODUITS[code as keyof typeof PRODUITS];
      expect({ min: p.min, max: p.max, minTerm: p.minTerm, maxTerm: p.maxTerm, pas: p.pas, frais: p.frais })
        .toEqual(ouverte.produits[code]);
      expect(p.code).toBe(code);
    }
    expect(Object.keys(PRODUITS).sort()).toEqual(Object.keys(ouverte.produits).sort());
  });

  it("EFFECTIF_DEPUIS et GRILLE_VERSION sortent de l'entrée ouverte", () => {
    expect(EFFECTIF_DEPUIS).toBe(ouverte.effectif_du);
    expect(GRILLE_VERSION).toBe(ouverte.version);
    expect(ouverte.effectif_au).toBeNull();
  });

  it("grilleValideA date l'audit : bornes inclusives à gauche, exclusives à droite", () => {
    expect(grilleValideA("2026-09-11").version).toBe(grille.historique[0].version);
    expect(grilleValideA(ouverte.effectif_du).version).toBe(ouverte.version);
    expect(grilleValideA("2100-01-01").version).toBe(ouverte.version);
  });

  it("la chaîne de hashes est valide : chaque entrée scelle la précédente", async () => {
    const { createHash } = await import("node:crypto");
    let precedent: string | null = null;
    for (const entree of grille.historique) {
      const { hash, ...reste } = entree;
      const canon = JSON.stringify({ pays: grille.pays, devise: grille.devise, ...reste });
      expect(hash).toBe(createHash("sha256").update(canon, "utf8").digest("hex"));
      expect(entree.hash_precedent).toBe(precedent);
      precedent = hash;
    }
  });

  it("les identifiants rate_BE_… du moteur sont dérivés de la table, pas recodés", () => {
    for (const code of Object.keys(ouverte.produits)) {
      const pr = ouverte.produits[code];
      for (const b of ouverte.paliers_taux) {
        if (b.min > pr.max) continue;
        const plafond = b.max === null ? pr.max : Math.min(b.max, pr.max);
        if (plafond < pr.min) continue;
        const plancher = Math.max(b.min, pr.min);
        const milieu = Math.max(plancher, Math.min(plafond, plancher + 1));
        const regle = findRateRule("BE", code, milieu, pr.minTerm);
        expect(regle?.id).toBe(`rate_BE_${code}_${plancher}_${plafond}`);
        expect(regle?.baseRate).toBe(b.taux);
      }
    }
  });

  it("simulateCredit scelle sa simulation avec la règle ET la version de grille", () => {
    const out = simulateCredit({ amount: 15_000, termMonths: 48, ...base, productType: "PERSONAL" } as any);
    expect(out.simulation.meta.rateRuleId).toBe("rate_BE_PERSONAL_1500_50000");
    expect(out.simulation.meta.grilleVersion).toBe(ouverte.version);
  });
});

describe("historique des grilles — écran SUPER_ADMIN (slice 9)", () => {
  const grille = JSON.parse(lu("rate_be/grille.json")) as {
    pays: string; historique: Array<{ version: string; effectif_du: string; effectif_au: string | null }>;
  };

  it("reglesDeEntree dérive pour l'écran EXACTEMENT les règles que le simulateur applique", () => {
    for (const entree of HISTORIQUE_GRILLES) {
      const regles = reglesDeEntree(entree, GRILLE.pays);
      expect(regles.length).toBeGreaterThan(0);
      const ids = new Set(regles.map((r) => r.id));
      expect(ids.size).toBe(regles.length); // unicité par version
      if (entree.effectif_au === null) {
        // Grille effective : chaque règle dérivée est celle que findRateRule résout.
        for (const r of regles) {
          const resolue = findRateRule(r.country, r.product, r.minAmount, r.minTerm);
          expect(resolue?.id).toBe(r.id);
          expect(resolue?.baseRate).toBe(r.baseRate);
        }
      }
    }
  });

  it("chaque chaînon de l'historique pointe vers le hash de la version précédente", () => {
    HISTORIQUE_GRILLES.forEach((entree, i) => {
      const precedente = i > 0 ? HISTORIQUE_GRILLES[i - 1] : null;
      expect(chainonValide(entree, precedente)).toBe(true);
      if (i === 0) expect(entree.hash_precedent).toBeNull();
    });
  });

  it("la sonde d'audit daté résout chaque version sur sa période", () => {
    for (const entree of HISTORIQUE_GRILLES) {
      expect(grilleValideA(`${entree.effectif_du}T00:00:00Z`).version).toBe(entree.version);
    }
    const derniere = HISTORIQUE_GRILLES[HISTORIQUE_GRILLES.length - 1];
    expect(grilleValideA("2100-01-01T00:00:00Z").version).toBe(derniere.version);
    expect(grille.historique.length).toBe(HISTORIQUE_GRILLES.length);
  });
});
