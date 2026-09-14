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
  DUREE_SESSION_JOURS, changerMotDePasse, confirmerPaiement, creerCompte, creerPaiement,
  deposerDemandeServeur, demandesPour, ecrireMagasin, enregistrerVirementEntrant, grillePourApi,
  hacherMotDePasse, lireMagasin, mettreAJourProfilServeur, nouveauSel, ouvrirSessionServeur,
  paiementsPour, reglerPaiement, VERSION_MAGASIN, optionsCookie, revoquerSession,
  simulerServeur, sondeGrillePourApi, trouverCompte, verifierMotDePasse, verifierSession,
  type DemandeServeur,
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

  it("cookie de session : Lax en dev, None+Secure en production (iframe cross-site de l'aperçu)", () => {
    const opts = optionsCookie(false);
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe("lax");
    expect(opts.maxAge).toBe(DUREE_SESSION_JOURS * 24 * 3600);
    const prod = optionsCookie(true);
    expect(prod.sameSite).toBe("none"); // sinon l'aperçu (iframe cross-site) perd la session
    expect(prod.secure).toBe(true);
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

describe("menu profil : le client édite SES champs (liste blanche serveur)", () => {
  it("applique les champs éditables, ignore les autres, borne la longueur", () => {
    const magasin = lireMagasin(dossier);
    const demo = magasin.comptes.find((c) => c.email === "client@kredit.be")!;
    const session = ouvrirSessionServeur(magasin, demo);
    const avant = { ...(demo.profil ?? {}) };
    const profil = mettreAJourProfilServeur(magasin, session, {
      ville: "Namur", telephone: "+32 81 00 00 00",
      prenom: "Pirate", nom: "Pirate", naissance: "1900-01-01", // non éditables
      rue: "X".repeat(500), // trop long -> borné à 200
    })!;
    expect(profil.ville).toBe("Namur");
    expect(profil.telephone).toBe("+32 81 00 00 00");
    expect(profil.prenom).toBe(avant.prenom); // identité protégée
    expect(profil.nom).toBe(avant.nom);
    expect(profil.naissance).toBe(avant.naissance);
    expect(profil.rue).toHaveLength(200);
  });
});

describe("demandes de crédit : table serveur, un aperçu par client", () => {
  it("le client démo reçoit deux demandes en cours, semées et persistées", () => {
    const magasin = lireMagasin(dossier);
    const siennes = demandesPour(magasin, "client@kredit.be");
    expect(siennes).toHaveLength(2);
    expect(siennes.map((d) => d.id).sort()).toEqual(["KRD-2026-DEMOA1", "KRD-2026-DEMOB2"]);
    expect(new Set(siennes.map((d) => d.statut))).toEqual(new Set(["SUBMITTED"]));
    ecrireMagasin(magasin, dossier);
    expect(demandesPour(lireMagasin(dossier), "client@kredit.be")).toHaveLength(2); // persistées
  });

  it("chaque client ne voit que SES demandes, pas celles des autres comptes", () => {
    const magasin = lireMagasin(dossier);
    expect(demandesPour(magasin, "autre@exemple.be")).toHaveLength(0);
    expect(demandesPour(magasin, "admin@kredit.be")).toHaveLength(0);
  });

  it("le dépôt ajoute la demande à la table du magasin", () => {
    const magasin = lireMagasin(dossier);
    const neuve: DemandeServeur = {
      id: "KRD-2026-TEST1", email: "autre@exemple.be", nom: "Autre", telephone: "",
      creeA: "2026-09-14T10:00:00.000Z", statut: "SUBMITTED",
      etat: {
        product: "BUSINESS", amount: 25_000, term: 60, income: 3_000, charges: 500,
        existing: 0, incomeType: "SALARY", employment: "CDI", purpose: "OTHER",
      },
    };
    deposerDemandeServeur(magasin, neuve);
    ecrireMagasin(magasin, dossier);
    const relire = lireMagasin(dossier);
    expect(demandesPour(relire, "autre@exemple.be")).toHaveLength(1);
    expect(demandesPour(relire, "client@kredit.be")).toHaveLength(2); // sans effet sur les autres
  });
});

describe("paiements & charges : semis, cycle de règlement, isolation par client", () => {
  it("le client démo reçoit trois paiements semés, dont la mensualité calculée par LE moteur", () => {
    const magasin = lireMagasin(dossier);
    const siens = paiementsPour(magasin, "client@kredit.be");
    expect(siens).toHaveLength(3);
    const entrant = siens.find((p) => p.type === "VIREMENT_ENTRANT")!;
    expect(entrant.statut).toBe("PAYE"); // les fonds sont arrivés : déjà encaissé
    expect(entrant.montant).toBe(1_850);
    const frais = siens.find((p) => p.type === "FRAIS")!;
    expect(frais.statut).toBe("EN_ATTENTE");
    expect(frais.demandeId).toBe("KRD-2026-DEMOA1");
    const mensualite = siens.find((p) => p.type === "MENSUALITE")!;
    const attendu = simulerServeur({
      amount: 15_000, termMonths: 48, monthlyIncome: 2_800, monthlyCharges: 950,
      incomeType: "SALARY", employmentStatus: "CDI", loanPurpose: "CONSUMPTION",
      existingCreditsMonthly: 0, country: "BE", productType: "PERSONAL",
    }).simulation.monthlyPayment;
    expect(mensualite.montant).toBe(Math.round(attendu * 100) / 100); // jamais un montant en dur
  });

  it("chaque client ne voit que SES paiements", () => {
    const magasin = lireMagasin(dossier);
    expect(paiementsPour(magasin, "autre@exemple.be")).toHaveLength(0);
    expect(paiementsPour(magasin, "admin@kredit.be")).toHaveLength(0);
  });

  it("l'administration crée une charge : elle naît « en attente de paiement »", () => {
    const magasin = lireMagasin(dossier);
    const r = creerPaiement(magasin, {
      email: "client@kredit.be", type: "FRAIS", libelle: "Frais de dossier", montant: 150.456,
      maintenant: "2026-09-14T10:00:00.000Z", echeance: "2026-09-30", demandeId: "KRD-2026-DEMOA1",
    });
    if ("erreur" in r) throw new Error("la création devrait réussir");
    expect(r.statut).toBe("EN_ATTENTE");
    expect(r.montant).toBe(150.46); // arrondi au centime
    expect(r.id).toMatch(/^PAY-20260914-/);
    expect(creerPaiement(magasin, { email: "client@kredit.be", type: "FRAIS", libelle: "x", montant: 0, maintenant: "2026-09-14T10:00:00.000Z" })).toEqual({ erreur: "montant_invalide" });
    const typeInterdit = creerPaiement(magasin, { email: "client@kredit.be", type: "VIREMENT_ENTRANT", libelle: "x", montant: 10, maintenant: "2026-09-14T10:00:00.000Z" });
    expect("erreur" in typeInterdit && typeInterdit.erreur).toBe("type_invalide");
  });

  it("le client règle → paiement déclaré ; l'administration confirme → payé", () => {
    const magasin = lireMagasin(dossier);
    const frais = paiementsPour(magasin, "client@kredit.be").find((p) => p.type === "FRAIS")!;
    // Un autre client ne peut pas régler à sa place.
    expect(reglerPaiement(magasin, frais.id, "pirate@exemple.be", "2026-09-15T10:00:00.000Z")).toEqual({ erreur: "introuvable" });
    const regle = reglerPaiement(magasin, frais.id, "client@kredit.be", "2026-09-15T10:00:00.000Z");
    expect(regle.paiement?.statut).toBe("DECLARE");
    expect(regle.paiement?.regleA).toBe("2026-09-15T10:00:00.000Z");
    expect(reglerPaiement(magasin, frais.id, "client@kredit.be", "2026-09-15T11:00:00.000Z").erreur).toBe("etat_inchange");
    const confirme = confirmerPaiement(magasin, frais.id, "2026-09-15T12:00:00.000Z");
    expect(confirme.paiement?.statut).toBe("PAYE");
    expect(confirme.paiement?.confirmeA).toBe("2026-09-15T12:00:00.000Z");
    expect(confirmerPaiement(magasin, frais.id, "2026-09-15T13:00:00.000Z").erreur).toBe("etat_inchange");
    ecrireMagasin(magasin, dossier);
    expect(paiementsPour(lireMagasin(dossier), "client@kredit.be").find((p) => p.id === frais.id)?.statut).toBe("PAYE");
  });

  it("l'administration peut marquer payée une charge encore en attente (règlement hors application)", () => {
    const magasin = lireMagasin(dossier);
    const frais = paiementsPour(magasin, "client@kredit.be").find((p) => p.type === "FRAIS")!;
    expect(confirmerPaiement(magasin, frais.id, "2026-09-16T09:00:00.000Z").paiement?.statut).toBe("PAYE");
  });

  it("le crédit déposé par l'administration crée un virement entrant déjà encaissé", () => {
    const magasin = lireMagasin(dossier);
    const p = enregistrerVirementEntrant(magasin, "client@kredit.be", 250, "Geste commercial", "2026-09-16T10:00:00.000Z");
    expect(p.type).toBe("VIREMENT_ENTRANT");
    expect(p.statut).toBe("PAYE");
    expect(paiementsPour(magasin, "client@kredit.be").some((x) => x.id === p.id)).toBe(true);
  });
});

describe("magasin versionné : un vieux format est re-semé, jamais réutilisé", () => {
  it("un magasin sans version (vieux déploiement) repart à neuf : données fantômes jetées", () => {
    const { writeFileSync, mkdirSync } = require("node:fs");
    const { join } = require("node:path");
    mkdirSync(dossier, { recursive: true });
    writeFileSync(join(dossier, "magasin.json"), JSON.stringify({
      comptes: [{ email: "vieux@exemple.be", role: "CUSTOMER", nom: "Vieux", sel: "x", hash: "y" }],
      sessions: [], banques: { "vieux@exemple.be::CUSTOMER": { iban: "BE00000000000000", verifie: true, photo: null, transactions: [], virements: [] } },
    }), "utf8");
    const magasin = lireMagasin(dossier);
    expect(magasin.comptes.some((c) => c.email === "vieux@exemple.be")).toBe(false); // jeté
    expect(magasin.banques).toBeUndefined(); // banques fantômes jetées
    expect(magasin.comptes.some((c) => c.role === "ADMIN")).toBe(true); // personnel re-semé
    ecrireMagasin(magasin, dossier);
    expect(lireMagasin(dossier).versionMagasin).toBe(VERSION_MAGASIN);
  });
});
