/**
 * @jest-environment node
 */
/**
 * Slice 11 — banque sur l'API : le serveur est la seule autorité.
 *
 * Ce qui est verrouillé : l'ouverture de la banque côté serveur (IBAN BE valide + dotation démo,
 * idempotente), le client n'envoie que des INTENTIONS (un compte non vérifié ne peut pas virer),
 * le pipeline auto-évolutif : l'initiation arrête la barre au premier défaut actif (30 %) avec un
 * code de déblocage émis côté serveur (jamais servi au client, l'admin le lit dans sa vue), le bon
 * code fait repartir la barre jusqu'au prochain arrêt puis 100 % + dénouement, un mauvais code ne
 * bouge rien, lever (admin) débloque sans code et la machine repart, refuser libère la réserve, CUSTOMER ne peut ni agir en staff ni lire la banque d'autrui, le chat est isolé par
 * compte, la photo est plafonnée, et une surcharge du référentiel change l'effectif SANS toucher
 * à la table canonique.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MONTANT_DEMO, REFERENTIEL_CANONIQUE, bicValide, disponibleDe, ibanBEValide, soldeDe,
  type BanqueCompte, type Referentiel,
} from "@/lib/banque";
import {
  creerCompte, lireMagasin, ouvrirSessionServeur, type Magasin, type SessionServeur,
} from "@/lib/serveur";

const cleDemo = "client@kredit.be::CUSTOMER";
import {
  PHOTO_MAX_OCTETS, actionAdmin, actionClient, banqueDeSession, chatPour, listeComptesClients,
  ouvrirBanquePour, referentielPourApi, surchargerReferentiel,
} from "@/lib/serveur-banque";

let dossier: string;
beforeEach(() => { dossier = mkdtempSync(join(tmpdir(), "kredit-banque-srv-")); });
afterEach(() => { rmSync(dossier, { recursive: true, force: true }); });

const MAINTENANT = "2026-09-14T10:00:00.000Z";
const BENEF = { nom: "Garage Central", iban: "BE68539007547034", adresse: "Chaussée de Wavre 123, 1050 Ixelles", bic: "GEBABEBB" }; // IBAN exemple publié par Febelfin
const ordre = (montant: number, motif: string) => ({
  action: "virement", beneficiaireNom: BENEF.nom, beneficiaireIban: BENEF.iban,
  beneficiaireAdresse: BENEF.adresse, beneficiaireBic: BENEF.bic, montant, motif,
});

function sessionClient(magasin: Magasin): SessionServeur {
  const c = creerCompte(magasin, { email: "nina@exemple.be", motDePasse: "assez-long-1", role: "CUSTOMER", nom: "Nina Client" });
  if ("erreur" in c) throw new Error("compte client attendu");
  return ouvrirSessionServeur(magasin, c);
}
function sessionAdmin(magasin: Magasin): SessionServeur {
  const c = creerCompte(magasin, { email: "olive@exemple.be", motDePasse: "assez-long-1", role: "ADMIN", nom: "Olive Ops" });
  if ("erreur" in c) throw new Error("compte admin attendu");
  return ouvrirSessionServeur(magasin, c);
}
const cle = "nina@exemple.be::CUSTOMER";

describe("ouverture de la banque côté serveur", () => {
  it("crée le compte avec un IBAN BE valide + dotation démo, et reste idempotent", () => {
    const magasin = lireMagasin(dossier);
    const session = sessionClient(magasin);
    ouvrirBanquePour(magasin, session.email, session.role, MAINTENANT);
    const compte = magasin.banques?.[cle];
    expect(compte).toBeTruthy();
    expect(ibanBEValide(compte!.iban)).toBe(true);
    expect(soldeDe(compte!)).toBe(MONTANT_DEMO);
    expect(compte!.verifie).toBe(false);
    // Une seconde ouverture ne crée ni second compte ni seconde dotation.
    ouvrirBanquePour(magasin, session.email, session.role, "2026-09-14T12:00:00.000Z");
    expect(magasin.banques?.[cle]).toBe(compte);
    expect(soldeDe(magasin.banques![cle])).toBe(MONTANT_DEMO);
  });

  it("banqueDeSession est réservée au CUSTOMER (son compte + le référentiel effectif)", () => {
    const magasin = lireMagasin(dossier);
    const session = sessionClient(magasin);
    const ok = banqueDeSession(magasin, session);
    expect("compte" in ok).toBe(true);
    expect((ok as { compte: BanqueCompte }).compte.iban.startsWith("BE")).toBe(true);
    expect(banqueDeSession(magasin, sessionAdmin(magasin))).toEqual({ erreur: "reserve_client", statut: 403 });
  });
});

describe("le client envoie des intentions, le serveur applique la machine", () => {
  it("refuse le virement tant que le compte n'est pas vérifié", () => {
    const magasin = lireMagasin(dossier);
    const session = sessionClient(magasin);
    const r = actionClient(magasin, session, ordre(500, "acompte"));
    expect(r.statut).toBe(400);
    expect(r.corps.erreur).toBe("non_verifie");
    expect(r.modifie).toBe(false);
  });

  it("une fois vérifié : l'initiation arrête la barre à 30 % ; codes admin → 60 % puis EXECUTE", () => {
    const magasin = lireMagasin(dossier);
    const session = sessionClient(magasin);
    const admin = sessionAdmin(magasin);
    banqueDeSession(magasin, session); // le portail ouvre la banque à l'affichage (comme le GET réel)
    expect(actionAdmin(magasin, admin, { action: "verifier", compteId: cle, verifie: true }).statut).toBe(200);

    const r = actionClient(magasin, session, ordre(500, "acompte"));
    expect(r.statut).toBe(200);
    expect(r.modifie).toBe(true);
    const compte = r.corps.compte as BanqueCompte;
    const v = compte.virements[0];
    expect(v.statut).toBe("BLOQUE"); // la barre évolue puis s'arrête au premier défaut actif (30 %)
    expect(v.niveau).toBe(2);
    expect(v.codeDeblocage).toBeUndefined(); // le code n'est JAMAIS servi au client
    expect(disponibleDe(compte)).toBe(MONTANT_DEMO - 500 - 25); // montant + coût du défaut réservés
    expect(soldeDe(compte)).toBe(MONTANT_DEMO); // rien n'est débité avant le dénouement

    // Mauvais code : 400, rien ne bouge.
    expect(actionClient(magasin, session, { action: "debloquer", virementId: v.id, code: "FAUX" }))
      .toMatchObject({ statut: 400, corps: { erreur: "code_invalide" }, modifie: false });

    // L'administration lit le code dans sa vue (dossier client).
    const code1 = listeComptesClients(magasin).find((x) => x.id === cle)!.compte.virements[0].codeDeblocage!;
    expect(code1).toMatch(/^[A-Z0-9]{12}$/); // généré automatiquement : 12 caractères alphanumériques
    const d1 = actionClient(magasin, session, { action: "debloquer", virementId: v.id, code: code1.toLowerCase() });
    expect(d1.statut).toBe(200); // insensible à la casse
    const v1 = (d1.corps.compte as BanqueCompte).virements.find((x) => x.id === v.id)!;
    expect(v1.statut).toBe("BLOQUE");
    expect(v1.niveau).toBe(3); // la barre repart et s'arrête à 60 %

    const code2 = listeComptesClients(magasin).find((x) => x.id === cle)!.compte.virements[0].codeDeblocage!;
    const d2 = actionClient(magasin, session, { action: "debloquer", virementId: v.id, code: code2 });
    expect(d2.statut).toBe(200);
    const fin = (d2.corps.compte as BanqueCompte).virements.find((x) => x.id === v.id)!;
    expect(fin.statut).toBe("EXECUTE"); // dernier déblocage : barre à 100 %, exécution
    const c2 = d2.corps.compte as BanqueCompte;
    expect(soldeDe(c2)).toBe(MONTANT_DEMO - 500 - 25 - 150); // dénouement : montant + frais des défauts
    expect(disponibleDe(c2)).toBe(MONTANT_DEMO - 500 - 25 - 150);
    // Un virement exécuté n'est plus déblocable.
    expect(actionClient(magasin, session, { action: "debloquer", virementId: v.id, code: code2 }).statut).toBe(400);
  });

  it("l'ordre de virement exige adresse du bénéficiaire et BIC/SWIFT valide, et les conserve", () => {
    const magasin = lireMagasin(dossier);
    const session = sessionClient(magasin);
    const admin = sessionAdmin(magasin);
    banqueDeSession(magasin, session);
    actionAdmin(magasin, admin, { action: "verifier", compteId: cle, verifie: true });
    expect(actionClient(magasin, session, { ...ordre(100, "x"), beneficiaireAdresse: "  " }))
      .toMatchObject({ statut: 400, corps: { erreur: "adresse_manquante" }, modifie: false });
    expect(actionClient(magasin, session, { ...ordre(100, "x"), beneficiaireBic: "1234" }))
      .toMatchObject({ statut: 400, corps: { erreur: "bic_invalide" }, modifie: false });
    const ok = actionClient(magasin, session, ordre(100, "x"));
    expect(ok.statut).toBe(200);
    const v = (ok.corps.compte as BanqueCompte).virements.at(-1)!;
    expect(v.beneficiaireBic).toBe("GEBABEBB");
    expect(v.beneficiaireAdresse).toBe(BENEF.adresse);
    expect(bicValide("gebabebb")).toBe(true); // insensible à la casse
    expect(bicValide("GEBABEBBXXX")).toBe(true); // forme longue (11)
    expect(bicValide("GEBABEB")).toBe(false);
  });

  it("l'arrêt réserve montant + coût ; lever (admin, sans code) repart au prochain arrêt", () => {
    const magasin = lireMagasin(dossier);
    const session = sessionClient(magasin);
    const admin = sessionAdmin(magasin);
    banqueDeSession(magasin, session);
    actionAdmin(magasin, admin, { action: "verifier", compteId: cle, verifie: true });
    const r = actionClient(magasin, session, ordre(300, "frais"));
    const v = (r.corps.compte as BanqueCompte).virements[0];
    expect(v.statut).toBe("BLOQUE");
    expect(v.blocages[0]).toMatchObject({ code: "JUSTIF_DOMICILE", cout: 25 });
    expect(disponibleDe(r.corps.compte as BanqueCompte)).toBe(MONTANT_DEMO - 300 - 25);

    const rl = actionAdmin(magasin, admin, { action: "lever", compteId: cle, virementId: v.id });
    expect(rl.statut).toBe(200);
    const leve = rl.corps.compte as BanqueCompte;
    const vl = leve.virements.find((x) => x.id === v.id)!;
    expect(vl.statut).toBe("BLOQUE"); // la machine repart et s'arrête au prochain défaut (60 %)
    expect(vl.niveau).toBe(3);
    expect(disponibleDe(leve)).toBe(MONTANT_DEMO - 300 - 150); // coût levé libéré, nouveau coût réservé
  });

  it("refuser libère toute la réserve ; annuler reste un droit du client tant que c'est vivant", () => {
    const magasin = lireMagasin(dossier);
    const session = sessionClient(magasin);
    const admin = sessionAdmin(magasin);
    banqueDeSession(magasin, session);
    actionAdmin(magasin, admin, { action: "verifier", compteId: cle, verifie: true });
    const r = actionClient(magasin, session, ordre(200, "test"));
    const v = (r.corps.compte as BanqueCompte).virements[0];

    const rf = actionAdmin(magasin, admin, { action: "refuser", compteId: cle, virementId: v.id });
    expect(rf.statut).toBe(200);
    const refuse = rf.corps.compte as BanqueCompte;
    expect(refuse.virements.find((x) => x.id === v.id)!.statut).toBe("REFUSE");
    expect(disponibleDe(refuse)).toBe(MONTANT_DEMO);

    // Annulation par le client sur un second virement (arrêté, donc encore annulable).
    const r2 = actionClient(magasin, session, ordre(100, "x"));
    const v2 = (r2.corps.compte as BanqueCompte).virements.at(-1)!;
    const ra = actionClient(magasin, session, { action: "annuler", virementId: v2.id });
    expect(ra.statut).toBe(200);
    const annule = ra.corps.compte as BanqueCompte;
    expect(annule.virements.find((x) => x.id === v2.id)!.statut).toBe("ANNULE");
    expect(disponibleDe(annule)).toBe(MONTANT_DEMO);
  });
});

describe("autorisations", () => {
  it("CUSTOMER ne peut ni agir en staff ni agir sur un autre compte", () => {
    const magasin = lireMagasin(dossier);
    const session = sessionClient(magasin);
    const admin = sessionAdmin(magasin);
    expect(actionAdmin(magasin, session, { action: "verifier", compteId: cle, verifie: true }).statut).toBe(403);
    expect(actionAdmin(magasin, session, { action: "crediter", compteId: cle, montant: 1 }).statut).toBe(403);
    // Un staff peut consulter la banque d'un client (vue support), mais n'en a pas de propre.
    expect(banqueDeSession(magasin, admin)).toEqual({ erreur: "reserve_client", statut: 403 });
    expect(actionClient(magasin, admin, { action: "chat", texte: "x" })).toEqual({ statut: 403, corps: { erreur: "reserve_client" }, modifie: false });
  });

  it("listeComptesClients ouvre la banque de chaque CUSTOMER et crediter ajoute une transaction", () => {
    const magasin = lireMagasin(dossier);
    sessionClient(magasin); // crée Nina (effet de bord voulu : elle doit apparaître dans la liste)
    const admin = sessionAdmin(magasin);
    creerCompte(magasin, { email: "paul@exemple.be", motDePasse: "assez-long-1", role: "CUSTOMER", nom: "Paul Second" });
    const liste = listeComptesClients(magasin);
    const ids = liste.map((x) => x.id).sort();
    expect(ids).toContain("nina@exemple.be::CUSTOMER");
    expect(ids).toContain("paul@exemple.be::CUSTOMER");
    expect(ids).toContain("client@kredit.be::CUSTOMER"); // compte démo semé
    const rc = actionAdmin(magasin, admin, { action: "crediter", compteId: cle, montant: 250, motif: "banque.tx.in" });
    expect(rc.statut).toBe(200);
    expect(soldeDe(rc.corps.compte as BanqueCompte)).toBe(MONTANT_DEMO + 250);
    expect(actionAdmin(magasin, admin, { action: "crediter", compteId: "inconnu::CUSTOMER", montant: 1 }).statut).toBe(404);
  });
});

describe("compte de démonstration « vitrine »", () => {
  it("le client démo arrive vérifié, avec un virement à chaque état du pipeline et le chat semé", () => {
    const magasin = lireMagasin(dossier); // sème client@kredit.be (CUSTOMER)
    const compteDemo = magasin.comptes.find((c) => c.email === "client@kredit.be")!;
    const session = ouvrirSessionServeur(magasin, compteDemo);
    const r = banqueDeSession(magasin, session);
    expect("compte" in r).toBe(true);
    const compte = (r as { compte: BanqueCompte }).compte;
    expect(compte.verifie).toBe(true); // le virement sortant est possible tout de suite
    const statuts = compte.virements.map((v) => v.statut).sort();
    expect(statuts).toEqual(["BLOQUE", "BLOQUE", "EXECUTE"]);
    const a30 = compte.virements.find((v) => v.niveau === 2)!;
    const a60 = compte.virements.find((v) => v.niveau === 3)!;
    expect(a30.statut).toBe("BLOQUE"); // arrêté à 30 %
    expect(a60.statut).toBe("BLOQUE"); // arrêté à 60 %
    // Le client ne voit JAMAIS les codes ; l'administration, oui (DEMO30 / DEMO60 en démo).
    expect(compte.virements.every((v) => v.codeDeblocage === undefined)).toBe(true);
    const vueAdmin = magasin.banques![cleDemo];
    expect(vueAdmin.virements.map((v) => v.codeDeblocage).filter(Boolean).sort()).toEqual(["DEMO30AB2026", "DEMO60AB2026"]);
    // Cohérence machine : 2500 (dotation) + 1850 (salaire) − 450 − 175 (frais des défauts du loyer exécuté)
    expect(soldeDe(compte)).toBe(2_500 + 1_850 - 450 - 175);
    // Réserves : 300 + 25 (arrêt 30 %) et 750 + 150 (arrêt 60 %)
    expect(disponibleDe(compte)).toBe(2_500 + 1_850 - 450 - 175 - 300 - 25 - 750 - 150);
    // Chat semé, lisible par le client comme par le staff.
    const chat = chatPour(magasin, session) as { messages: Array<{ de: string }> };
    expect(chat.messages).toHaveLength(4);
    expect(chatPour(magasin, sessionAdmin(magasin), cleDemo)).toEqual(chat);
  });

  it("un nouvel inscrit repart vierge (non vérifié, sans historique) — la vitrine est réservée au démo", () => {
    const magasin = lireMagasin(dossier);
    const session = sessionClient(magasin);
    const compte = (banqueDeSession(magasin, session) as { compte: BanqueCompte }).compte;
    expect(compte.verifie).toBe(false);
    expect(compte.virements).toHaveLength(0);
    expect(compte.transactions).toHaveLength(1);
  });

  it("un compte stocké SANS mouvements est écarté puis re-semé — jamais de solde 0,00 € fantôme", () => {
    const magasin = lireMagasin(dossier);
    const compteDemo = magasin.comptes.find((c) => c.email === "client@kredit.be")!;
    const session = ouvrirSessionServeur(magasin, compteDemo);
    // Corruption : un vieux magasin manipulé hors du code courant a laissé un compte vide.
    magasin.banques = magasin.banques ?? {};
    magasin.banques[cleDemo] = { iban: "BE00000000000000", verifie: true, photo: null, transactions: [], virements: [] };
    const r = banqueDeSession(magasin, session) as { compte: BanqueCompte };
    expect(r.compte.transactions.length).toBeGreaterThan(0); // re-semé, pas 0,00 €
    expect(r.compte.verifie).toBe(true);                    // la vitrine démo est restaurée
    expect(soldeDe(r.compte)).toBe(2_500 + 1_850 - 450 - 175);
    // Même garde pour un compte non-démo : il repart avec sa dotation d'ouverture.
    const sessionNeuve = sessionClient(magasin);
    magasin.banques[`${sessionNeuve.email}::CUSTOMER`] = { iban: "BE00000000000000", verifie: false, photo: null, transactions: [], virements: [] };
    const r2 = banqueDeSession(magasin, sessionNeuve) as { compte: BanqueCompte };
    expect(r2.compte.transactions).toHaveLength(1);
    expect(soldeDe(r2.compte)).toBe(MONTANT_DEMO);
  });
});

describe("chat, photo et référentiel", () => {
  it("chat : le client ne lit que le sien, le staff lit celui demandé, les deux écrivent", () => {
    const magasin = lireMagasin(dossier);
    const session = sessionClient(magasin);
    const admin = sessionAdmin(magasin);
    actionClient(magasin, session, { action: "chat", texte: "Bonjour" });
    actionAdmin(magasin, admin, { action: "chat", compteId: cle, texte: "Support KREDIT, à vous" });
    const vuClient = chatPour(magasin, session);
    const vuAdmin = chatPour(magasin, admin, cle);
    expect(vuClient).toEqual({ messages: expect.any(Array) });
    expect((vuClient as { messages: Array<{ texte: string; de: string }> }).messages.map((m) => `${m.de}:${m.texte}`))
      .toEqual(["client:Bonjour", "support:Support KREDIT, à vous"]);
    expect(vuAdmin).toEqual(vuClient);
    // Le compte demandé est ignoré pour un client : pas de lecture du chat d'autrui.
    expect(chatPour(magasin, session, "paul@exemple.be::CUSTOMER")).toEqual(vuClient);
    // Staff sans compte demandé : 400.
    expect(chatPour(magasin, admin)).toEqual({ erreur: "champs_manquants", statut: 400 });
  });

  it("photo : accepte une petite, refuse au-delà de la limite", () => {
    const magasin = lireMagasin(dossier);
    const session = sessionClient(magasin);
    const ok = actionClient(magasin, session, { action: "photo", photo: "data:image/jpeg;base64,abc" });
    expect(ok.statut).toBe(200);
    expect((ok.corps.compte as BanqueCompte).photo).toBe("data:image/jpeg;base64,abc");
    const trop = actionClient(magasin, session, { action: "photo", photo: "x".repeat(PHOTO_MAX_OCTETS + 1) });
    expect(trop.statut).toBe(413);
    const retrait = actionClient(magasin, session, { action: "photo", photo: null });
    expect(retrait.statut).toBe(200);
    expect((retrait.corps.compte as BanqueCompte).photo).toBeNull();
  });

  it("surcharge du référentiel : change l'effectif (réservé staff), la table canonique reste intacte", () => {
    const magasin = lireMagasin(dossier);
    const admin = sessionAdmin(magasin);
    const session = sessionClient(magasin);
    expect(referentielPourApi(magasin).referentiel.defauts.find((d) => d.code === "CERT_ASSURANCE")!.cout).toBe(150);
    expect(surchargerReferentiel(magasin, session, { code: "CERT_ASSURANCE", cout: 1 }).statut).toBe(403);
    expect(surchargerReferentiel(magasin, admin, { code: "PAS_UN_CODE" }).statut).toBe(400);
    const r = surchargerReferentiel(magasin, admin, { code: "CERT_ASSURANCE", cout: 300 });
    expect(r.statut).toBe(200);
    expect(referentielPourApi(magasin).referentiel.defauts.find((d) => d.code === "CERT_ASSURANCE")!.cout).toBe(300);
    expect(REFERENTIEL_CANONIQUE.defauts.find((d) => d.code === "CERT_ASSURANCE")!.cout).toBe(150);
  });

  it("l'admin crée un champ (niveau, montant, motif) : la barre s'y arrête, le motif part en transaction", () => {
    const magasin = lireMagasin(dossier);
    const session = sessionClient(magasin);
    const admin = sessionAdmin(magasin);
    banqueDeSession(magasin, session);
    actionAdmin(magasin, admin, { action: "verifier", compteId: cle, verifie: true });
    const rc = surchargerReferentiel(magasin, admin, { code: "FRAIS_NOTAIRE", creer: true, pct: 45, cout: 80, actif: true, motif: "Frais de notaire" });
    expect(rc.statut).toBe(200);
    expect((rc.corps as { referentiel: Referentiel }).referentiel.pipeline.map((n) => n.pct)).toContain(45);
    // Création sans pct : refusée.
    expect(surchargerReferentiel(magasin, admin, { code: "SANS_NIVEAU", creer: true }).statut).toBe(400);

    const r = actionClient(magasin, session, ordre(400, "notaire"));
    const vid = (r.corps.compte as BanqueCompte).virements.at(-1)!.id;
    const lireCode = () => listeComptesClients(magasin).find((x) => x.id === cle)!.compte.virements.find((x) => x.id === vid)!.codeDeblocage!;
    const etat = () => listeComptesClients(magasin).find((x) => x.id === cle)!.compte.virements.find((x) => x.id === vid)!;
    expect(etat().niveau).toBe(2); // premier arrêt : 30 %

    let d = actionClient(magasin, session, { action: "debloquer", virementId: vid, code: lireCode() });
    expect(d.statut).toBe(200);
    expect(etat().niveau).toBe(3); // la barre s'arrête au champ créé (45 %)
    expect(etat().blocages.filter((b) => !b.leveA)[0]).toMatchObject({ code: "FRAIS_NOTAIRE", cout: 80, motif: "Frais de notaire" });

    d = actionClient(magasin, session, { action: "debloquer", virementId: vid, code: lireCode() });
    expect(etat().niveau).toBe(4); // puis 60 %
    d = actionClient(magasin, session, { action: "debloquer", virementId: vid, code: lireCode() });
    expect(etat().statut).toBe("EXECUTE"); // dernier code : 100 %

    // Le compte du client porte une transaction de frais avec le motif défini par l'admin.
    const final = d.corps.compte as BanqueCompte;
    expect(final.transactions.find((t) => t.motifLibre === "Frais de notaire")).toMatchObject({ sens: "sortant", montant: 80 });
    expect(soldeDe(final)).toBe(MONTANT_DEMO - 400 - 25 - 80 - 150);
  });
});
