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
  DOCUMENT_MAX_OCTETS, DUREE_SESSION_JOURS, approuverDocument, changerMotDePasse,
  confirmerPaiement, contratsPour, creerCompte, creerContrat, creerPaiement,
  deposerDemandeServeur, deposerDocument,
  demandesPour, documentsPour, ecrireMagasin, enregistrerVirementEntrant, grillePourApi,
  hacherMotDePasse, lireMagasin, majContrat, mettreAJourPrefsNotif, mettreAJourProfilServeur,
  mensualiteContrat, notifierContrat,
  notificationsPour, notifierClient, notifierStaff, nouveauSel, ouvrirSessionServeur, paiementsPour,
  reglerPaiement, VERSION_MAGASIN, optionsCookie, revoquerSession, simulerServeur,
  sondeGrillePourApi, trouverCompte, verifierMotDePasse, verifierSession, type DemandeServeur,
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

describe("documents justificatifs : dépôt client, approbation admin, notification", () => {
  it("le client démo reçoit deux pièces semées : une approuvée (avec notification) et une soumise", () => {
    const magasin = lireMagasin(dossier);
    const docs = documentsPour(magasin, "client@kredit.be");
    expect(docs).toHaveLength(2);
    const approuve = docs.find((d) => d.statut === "APPROUVE")!;
    expect(approuve.code).toBe("ID");
    expect(approuve.approuvePar).toBeTruthy();
    const soumis = docs.find((d) => d.statut === "SOUMIS")!;
    expect(soumis.code).toBe("INCOME_3M");
    const notifs = notificationsPour(magasin, "client@kredit.be");
    expect(notifs).toHaveLength(1);
    expect(notifs[0].cle).toBe("documents.notify.approved");
    expect(notifs[0].vars?.doc).toBe("credit:documents.ID");
  });

  it("chaque client ne voit que SES documents", () => {
    const magasin = lireMagasin(dossier);
    expect(documentsPour(magasin, "autre@exemple.be")).toHaveLength(0);
  });

  it("le dépôt crée une pièce SOUMISE ; un re-dépôt remplace la soumise ; l'approuvée est figée", () => {
    const magasin = lireMagasin(dossier);
    const base = { email: "client@kredit.be", demandeId: "KRD-2026-DEMOA1", nom: "piece.txt", donnees: "data:text/plain;base64,dGVzdA==", taille: 1234, maintenant: "2026-09-14T10:00:00.000Z" };
    const r1 = deposerDocument(magasin, { ...base, code: "PROOF_ADDRESS" });
    if (!r1.document) throw new Error("le dépôt devrait réussir");
    expect(r1.document.statut).toBe("SOUMIS");
    const r2 = deposerDocument(magasin, { ...base, code: "PROOF_ADDRESS", nom: "piece-v2.txt", maintenant: "2026-09-14T11:00:00.000Z" });
    expect(r2.document?.id).toBe(r1.document.id); // remplacée, pas dupliquée
    expect(r2.document?.nom).toBe("piece-v2.txt");
    expect(documentsPour(magasin, "client@kredit.be").filter((d) => d.code === "PROOF_ADDRESS")).toHaveLength(1);
    // La pièce ID est APPROUVÉE : impossible de la remplacer.
    expect(deposerDocument(magasin, { ...base, code: "ID" }).erreur).toBe("code_invalide");
    // Garde-fous : code hors référentiel, fichier invalide, fichier trop lourd.
    expect(deposerDocument(magasin, { ...base, code: "HORS_REFERENTIEL" }).erreur).toBe("code_invalide");
    expect(deposerDocument(magasin, { ...base, code: "ID", donnees: "pas-une-dataurl" }).erreur).toBe("fichier_invalide");
    expect(deposerDocument(magasin, { ...base, code: "PROOF_ADDRESS", taille: DOCUMENT_MAX_OCTETS + 1 }).erreur).toBe("trop_lourd");
  });

  it("l'admin approuve : statut APPROUVE ; rejeu refusé", () => {
    const magasin = lireMagasin(dossier);
    const soumis = documentsPour(magasin, "client@kredit.be").find((d) => d.statut === "SOUMIS")!;
    const r = approuverDocument(magasin, soumis.id, "Admin KREDIT", "2026-09-15T09:00:00.000Z");
    expect(r.document?.statut).toBe("APPROUVE");
    expect(r.document?.approuvePar).toBe("Admin KREDIT");
    expect(r.document?.approuveA).toBe("2026-09-15T09:00:00.000Z");
    expect(approuverDocument(magasin, soumis.id, "Admin KREDIT", "2026-09-15T10:00:00.000Z").erreur).toBe("etat_inchange");
    expect(approuverDocument(magasin, "DOC-INEXISTANT", "Admin KREDIT", "2026-09-15T10:00:00.000Z").erreur).toBe("introuvable");
    ecrireMagasin(magasin, dossier);
    expect(documentsPour(lireMagasin(dossier), "client@kredit.be").find((d) => d.id === soumis.id)?.statut).toBe("APPROUVE");
  });
});

describe("centre de notification : site + e-mail (Resend) + WhatsApp (API Cloud Meta)", () => {
  const FAUX_FETCH_OK = async () => ({ ok: true, status: 200 });
  const FAUX_FETCH_500 = async () => ({ ok: false, status: 500 });
  const CFG = { resend: { cle: "re_test", de: "KREDIT <notifications@kredit.example>" }, whatsapp: { jeton: "wa_test", idTelephone: "123456" } };

  it("sans fournisseur configuré : la notification sur site part, les canaux sont « non configuré »", async () => {
    const magasin = lireMagasin(dossier);
    const n = await notifierClient(magasin, { email: "client@kredit.be", cle: "documents.notify.approved", vars: { doc: "credit:documents.ID" }, maintenant: "2026-09-15T09:00:00.000Z" }, { config: {}, fetchImpl: FAUX_FETCH_OK });
    expect(n.canaux?.email).toBe("non_configure");
    expect(n.canaux?.whatsapp).toBe("non_configure");
    expect(notificationsPour(magasin, "client@kredit.be").some((x) => x.id === n.id)).toBe(true); // site : toujours
  });

  it("fournisseurs configurés + préférences actives : e-mail et WhatsApp ENVOYÉS", async () => {
    const magasin = lireMagasin(dossier);
    const n = await notifierClient(magasin, { email: "client@kredit.be", cle: "payments.notify.confirmed", vars: { libelle: "Frais de dossier" }, maintenant: "2026-09-15T09:00:00.000Z" }, { config: CFG, fetchImpl: FAUX_FETCH_OK });
    expect(n.canaux?.email).toBe("envoye");
    expect(n.canaux?.whatsapp).toBe("envoye"); // le n° du profil est normalisé +32470123456
  });

  it("préférences coupées : canaux « désactivé », AUCUN appel réseau", async () => {
    const magasin = lireMagasin(dossier);
    const demo = magasin.comptes.find((c) => c.email === "client@kredit.be")!;
    demo.prefsNotif = { email: false, whatsapp: false };
    let appels = 0;
    const n = await notifierClient(magasin, { email: "client@kredit.be", cle: "banque.notify.credit", vars: { montant: "500,00 €" }, maintenant: "2026-09-15T09:00:00.000Z" }, { config: CFG, fetchImpl: async () => { appels += 1; return { ok: true, status: 200 }; } });
    expect(n.canaux?.email).toBe("desactive");
    expect(n.canaux?.whatsapp).toBe("desactive");
    expect(appels).toBe(0); // désactivé = pas d'envoi
  });

  it("erreur du fournisseur : canal « échec », la notification sur site existe quand même", async () => {
    const magasin = lireMagasin(dossier);
    const n = await notifierClient(magasin, { email: "client@kredit.be", cle: "payments.notify.charge", vars: { libelle: "x", montant: "1 €" }, maintenant: "2026-09-15T09:00:00.000Z" }, { config: CFG, fetchImpl: FAUX_FETCH_500 });
    expect(n.canaux?.email).toBe("echec");
    expect(n.canaux?.whatsapp).toBe("echec");
    expect(notificationsPour(magasin, "client@kredit.be").some((x) => x.id === n.id)).toBe(true);
  });

  it("le client règle ses préférences de distribution (liste blanche : email/whatsapp uniquement)", () => {
    const magasin = lireMagasin(dossier);
    const demo = magasin.comptes.find((c) => c.email === "client@kredit.be")!;
    const session = ouvrirSessionServeur(magasin, demo);
    const prefs = mettreAJourPrefsNotif(magasin, session, { email: false, whatsapp: true, role: "SUPER_ADMIN" });
    expect(prefs).toEqual({ email: false, whatsapp: true }); // l'intrus est ignoré
    ecrireMagasin(magasin, dossier);
    expect(lireMagasin(dossier).comptes.find((c) => c.email === "client@kredit.be")?.prefsNotif).toEqual({ email: false, whatsapp: true });
  });
});

describe("chat : le client qui répond notifie le personnel (site + e-mail réel, pas de WhatsApp)", () => {
  const FAUX_FETCH_OK = async () => ({ ok: true, status: 200 });
  const CFG = { resend: { cle: "re_test", de: "KREDIT <notifications@kredit.example>" }, whatsapp: { jeton: "wa_test", idTelephone: "123456" } };

  it("chaque membre du personnel reçoit SA notification sur site + e-mail", async () => {
    const magasin = lireMagasin(dossier);
    const notifs = await notifierStaff(magasin, { cle: "notifications.chat.fromClient", vars: { client: "Client KREDIT" }, maintenant: "2026-09-15T09:00:00.000Z" }, { config: CFG, fetchImpl: FAUX_FETCH_OK });
    // ADMIN + SUPER_ADMIN semés : une notification chacun, jamais le compte client.
    expect(notifs.map((n) => n.email).sort()).toEqual(["admin@kredit.be", "super@kredit.be"]);
    for (const n of notifs) {
      expect(n.canaux?.email).toBe("envoye");
      expect(n.canaux?.whatsapp).toBeUndefined(); // le personnel n'a pas de numéro au dossier
      expect(notificationsPour(magasin, n.email).some((x) => x.id === n.id)).toBe(true);
    }
  });

  it("sans fournisseur configuré : le canal e-mail est « non configuré », la notification sur site part", async () => {
    const magasin = lireMagasin(dossier);
    const notifs = await notifierStaff(magasin, { cle: "notifications.chat.fromClient", vars: { client: "X" }, maintenant: "2026-09-15T09:00:00.000Z" }, { config: {}, fetchImpl: FAUX_FETCH_OK });
    expect(notifs.length).toBeGreaterThan(0);
    for (const n of notifs) expect(n.canaux?.email).toBe("non_configure");
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

describe("contrats : mensualité calculée, CRUD borné, notification (slice 23)", () => {
  const MAINTENANT = "2026-09-15T10:00:00.000Z";
  it("mensualiteContrat : annuité constante, taux nul = division simple, entrées invalides = 0", () => {
    // 10 000 € / 12 mois / 12 % annuel → r = 1 %/mois, annuité ≈ 888,49 €.
    expect(mensualiteContrat(10_000, 12, 12)).toBeCloseTo(888.49, 1);
    expect(mensualiteContrat(12_000, 12, 0)).toBe(1000); // taux nul
    expect(mensualiteContrat(0, 12, 5)).toBe(0);
    expect(mensualiteContrat(10_000, 0, 5)).toBe(0);
    expect(mensualiteContrat(10_000, 12, -1)).toBe(0);
  });

  it("creerContrat valide, calcule la mensualité et borne les mentions", () => {
    const magasin = lireMagasin(dossier); // sème client@kredit.be
    const r = creerContrat(magasin, {
      email: "client@kredit.be", objet: "Prêt véhicule", montant: 10_000, dureeMois: 12, tauxAnnuel: 12,
      mentions: ["Assurance solde restant dû", "   ", "Mention bornée"], maintenant: MAINTENANT,
    });
    expect(r.contrat).toBeDefined();
    const c = r.contrat!;
    expect(c.statut).toBe("BROUILLON");
    expect(c.mensualite).toBeCloseTo(888.49, 1);
    expect(c.mentions).toEqual(["Assurance solde restant dû", "Mention bornée"]); // vides retirées
    expect(contratsPour(magasin, "client@kredit.be")).toHaveLength(2); // semé + créé
  });

  it("creerContrat rejette un compte inconnu et des valeurs hors bornes", () => {
    const magasin = lireMagasin(dossier);
    const base = { email: "client@kredit.be", objet: "x", montant: 10_000, dureeMois: 12, tauxAnnuel: 5, maintenant: MAINTENANT };
    expect(creerContrat(magasin, { ...base, email: "personne@exemple.be" }).erreur).toBe("compte_introuvable");
    expect(creerContrat(magasin, { ...base, montant: 0 }).erreur).toBe("montant_invalide");
    expect(creerContrat(magasin, { ...base, dureeMois: 0 }).erreur).toBe("duree_invalide");
    expect(creerContrat(magasin, { ...base, dureeMois: 12.5 }).erreur).toBe("duree_invalide");
    expect(creerContrat(magasin, { ...base, tauxAnnuel: 99 }).erreur).toBe("taux_invalide");
    expect(creerContrat(magasin, { ...base, objet: "" }).erreur).toBe("objet_invalide");
    expect(creerContrat(magasin, { ...base, mentions: new Array(13).fill("m") }).erreur).toBe("mentions_invalides");
    expect(creerContrat(magasin, { ...base, mentions: [42] }).erreur).toBe("mentions_invalides");
  });

  it("majContrat recalcule la mensualité, garde les champs absents et borne", () => {
    const magasin = lireMagasin(dossier);
    const c = creerContrat(magasin, {
      email: "client@kredit.be", objet: "Prêt", montant: 10_000, dureeMois: 12, tauxAnnuel: 12, maintenant: MAINTENANT,
    }).contrat!;
    const r = majContrat(magasin, c.id, "2026-09-16T10:00:00.000Z", { montant: 20_000 });
    expect(r.contrat!.mensualite).toBeCloseTo(2 * 888.49, 0); // proportionnel au capital doublé
    expect(r.contrat!.objet).toBe("Prêt"); // champ absent conservé
    expect(r.contrat!.majA).toBe("2026-09-16T10:00:00.000Z");
    expect(majContrat(magasin, c.id, MAINTENANT, { tauxAnnuel: 99 }).erreur).toBe("taux_invalide");
    expect(majContrat(magasin, "INCONNU", MAINTENANT, {}).erreur).toBe("introuvable");
  });

  it("notifierContrat passe le contrat en NOTIFIE et date la transmission", () => {
    const magasin = lireMagasin(dossier);
    const c = creerContrat(magasin, {
      email: "client@kredit.be", objet: "Prêt", montant: 10_000, dureeMois: 12, tauxAnnuel: 5, maintenant: MAINTENANT,
    }).contrat!;
    const r = notifierContrat(magasin, c.id, "2026-09-16T12:00:00.000Z");
    expect(r.contrat!.statut).toBe("NOTIFIE");
    expect(r.contrat!.notifieA).toBe("2026-09-16T12:00:00.000Z");
    expect(notifierContrat(magasin, "INCONNU", MAINTENANT).erreur).toBe("introuvable");
  });

  it("un contrat de démonstration est semé pour le client vitrine, taux en pourcentage", () => {
    const magasin = lireMagasin(dossier);
    const semes = contratsPour(magasin, "client@kredit.be");
    expect(semes.length).toBeGreaterThan(0);
    expect(semes[0].statut).toBe("BROUILLON");
    expect(semes[0].tauxAnnuel).toBeGreaterThan(1); // fraction de grille convertie en %, pas 0.025
    expect(semes[0].mensualite).toBeGreaterThan(0);
    // Cohérence : mensualité recalculée depuis les champs stockés (convention %).
    expect(semes[0].mensualite).toBeCloseTo(mensualiteContrat(semes[0].montant, semes[0].dureeMois, semes[0].tauxAnnuel), 2);
  });
});
