/**
 * @jest-environment node
 */
/**
 * Slice 10 — serveur d'authentification et d'API : verrous.
 *
 * Ce qui est verrouillé : le hachage scrypt salé (jamais de comparaison de mots de passe en
 * clair), le cycle de vie des sessions (jeton, expiration, révocation), le semis idempotent des
 * comptes de démonstration, et surtout LE MIROIR — grillePourApi() (ce que sert /api/grille) est
 * identique à ce que le moteur frontend exporte de la même table canonique.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GRILLE, GRILLE_VERSION, HISTORIQUE_GRILLES, reglesDeEntree } from "@/lib/credit-engine";
import {
  DUREE_SESSION_JOURS, changerMotDePasse, creerCompte, ecrireMagasin, grillePourApi,
  hacherMotDePasse, lireMagasin, nouveauSel, ouvrirSessionServeur, optionsCookie,
  revoquerSession, simulerServeur, sondeGrillePourApi, trouverCompte, verifierMotDePasse,
  verifierSession,
} from "@/lib/serveur";
import { COMPTES_PORTE_DEMO } from "@/lib/serveur-demo";

let dossier: string;
beforeEach(() => { dossier = mkdtempSync(join(tmpdir(), "kredit-srv-")); });
afterEach(() => { rmSync(dossier, { recursive: true, force: true }); });

describe("mot de passe : scrypt salé, jamais de clair", () => {
  it("vérifie le bon mot de passe et rejette les autres", () => {
    const sel = nouveauSel();
    const hash = hacherMotDePasse("mot-de-passe-1", sel);
    expect(hash).not.toContain("mot-de-passe-1");
    expect(verifierMotDePasse("mot-de-passe-1", sel, hash)).toBe(true);
    expect(verifierMotDePasse("mot-de-passe-2", sel, hash)).toBe(false);
    expect(verifierMotDePasse("mot-de-passe-1", nouveauSel(), hash)).toBe(false);
  });
});

describe("magasin et comptes de démonstration", () => {
  it("sème les comptes démo à la première lecture, une seule fois", () => {
    const magasin = lireMagasin(dossier);
    expect(magasin.comptes.map((c) => c.email).sort()).toEqual(COMPTES_PORTE_DEMO.map((c) => c.email).sort());
    ecrireMagasin(magasin, dossier);
    const relire = lireMagasin(dossier);
    expect(relire.comptes.length).toBe(COMPTES_PORTE_DEMO.length); // idempotent
    for (const porte of COMPTES_PORTE_DEMO) {
      const compte = trouverCompte(magasin, porte.email, porte.role);
      expect(compte).not.toBeNull();
      expect(verifierMotDePasse(porte.motDePasse, compte!.sel, compte!.hash)).toBe(true);
    }
  });

  it("crée un compte client, refuse les doublons et les saisies invalides", () => {
    const magasin = lireMagasin(dossier);
    const compte = creerCompte(magasin, { email: "Client@Exemple.be", motDePasse: "assez-long-1", role: "CUSTOMER", nom: "Jean Demo" });
    expect("erreur" in compte).toBe(false);
    expect((compte as { email: string }).email).toBe("client@exemple.be");
    expect(creerCompte(magasin, { email: "client@exemple.be", motDePasse: "assez-long-2", role: "CUSTOMER", nom: "Autre" })).toEqual({ erreur: "existant" });
    expect(creerCompte(magasin, { email: "pas-un-email", motDePasse: "assez-long-1", role: "CUSTOMER", nom: "X" })).toEqual({ erreur: "invalide" });
    expect(creerCompte(magasin, { email: "court@exemple.be", motDePasse: "court", role: "CUSTOMER", nom: "X" })).toEqual({ erreur: "invalide" });
  });

  it("le changement de mot de passe exige l'actuel", () => {
    const magasin = lireMagasin(dossier);
    creerCompte(magasin, { email: "c@exemple.be", motDePasse: "assez-long-1", role: "CUSTOMER", nom: "C" });
    expect(changerMotDePasse(magasin, "c@exemple.be", "CUSTOMER", "faux", "nouveau-long-1")).toBe(false);
    expect(changerMotDePasse(magasin, "c@exemple.be", "CUSTOMER", "assez-long-1", "nouveau-long-1")).toBe(true);
    const compte = trouverCompte(magasin, "c@exemple.be", "CUSTOMER")!;
    expect(verifierMotDePasse("nouveau-long-1", compte.sel, compte.hash)).toBe(true);
    expect(verifierMotDePasse("assez-long-1", compte.sel, compte.hash)).toBe(false);
  });
});

describe("sessions : jetons serveur, expiration, révocation", () => {
  it("ouvre, vérifie, expire et révoque", () => {
    const magasin = lireMagasin(dossier);
    const compte = trouverCompte(magasin, "admin@kredit.be", "ADMIN")!;
    const maintenant = new Date("2026-09-13T12:00:00Z");
    const session = ouvrirSessionServeur(magasin, compte, maintenant);
    expect(session.jeton).toMatch(/^[0-9a-f]{64}$/);
    expect(verifierSession(magasin, session.jeton, maintenant)).not.toBeNull();
    const apresExpiration = new Date(maintenant.getTime() + (DUREE_SESSION_JOURS + 1) * 24 * 3600 * 1000);
    expect(verifierSession(magasin, session.jeton, apresExpiration)).toBeNull();
    expect(verifierSession(magasin, "jeton-inconnu", maintenant)).toBeNull();
    expect(revoquerSession(magasin, session.jeton)).toBe(true);
    expect(verifierSession(magasin, session.jeton, maintenant)).toBeNull();
    expect(revoquerSession(magasin, session.jeton)).toBe(false);
  });

  it("le cookie de session est httpOnly + SameSite=Lax", () => {
    const opts = optionsCookie(false);
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe("lax");
    expect(opts.maxAge).toBe(DUREE_SESSION_JOURS * 24 * 3600);
  });
});

describe("le miroir : /api/grille sert exactement la table canonique", () => {
  it("version, chaînons et règles effectives identiques au moteur frontend", () => {
    const api = grillePourApi();
    expect(api.schema).toBe(GRILLE.schema);
    expect(api.pays).toBe(GRILLE.pays);
    expect(api.version).toBe(GRILLE_VERSION);
    expect(api.historique).toHaveLength(HISTORIQUE_GRILLES.length);
    expect(api.historique.every((h) => h.chainon_valide)).toBe(true);
    const ouverte = HISTORIQUE_GRILLES.find((e) => e.effectif_au === null)!;
    const attendues = reglesDeEntree(ouverte, GRILLE.pays).map((r) => ({
      id: r.id, minAmount: r.minAmount, maxAmount: r.maxAmount, baseRate: r.baseRate,
    }));
    expect(api.regles_effectives).toEqual(attendues);
  });

  it("la sonde datée du serveur répond comme grilleValideA", () => {
    const ouverte = HISTORIQUE_GRILLES[HISTORIQUE_GRILLES.length - 1];
    expect(sondeGrillePourApi(ouverte.effectif_du)?.version).toBe(ouverte.version);
    expect(sondeGrillePourApi("2100-01-01")?.version).toBe(ouverte.version);
    expect(sondeGrillePourApi("13/09/2026")).toBeNull();
  });
});

describe("simulation côté serveur : même moteur, mêmes scellements", () => {
  it("15 000 € / 48 mois PERSONAL — identique au contrat du simulateur", () => {
    const out = simulerServeur({
      amount: 15_000, termMonths: 48, monthlyIncome: 5_000, monthlyCharges: 800,
      incomeType: "SALARY", employmentStatus: "CDI", loanPurpose: "VEHICLE",
      existingCreditsMonthly: 0, country: "BE", productType: "PERSONAL",
    });
    expect(out.simulation.monthlyPayment).toBeCloseTo(328.71, 2);
    expect(out.simulation.meta.rateRuleId).toBe("rate_BE_PERSONAL_1500_50000");
    expect(out.simulation.meta.grilleVersion).toBe(GRILLE_VERSION);
  });
});
