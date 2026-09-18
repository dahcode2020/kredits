/**
 * @jest-environment node
 */
/**
 * Slice 11 — banque sur l'API : le serveur est la seule autorité.
 *
 * Ce qui est verrouillé : l'ouverture de la banque côté serveur (IBAN BE valide + dotation démo,
 * idempotente), le client n'envoie que des INTENTIONS (un compte non vérifié ne peut pas virer),
 * la progression EN DIRECT (slice 22) : l'initiation planifie la cadence sans précipiter l'arrêt,
 * chaque palier échu est confirmé par le serveur avec une notification site, le point de
 * validation arrête la marche (code émis côté serveur, jamais servi au client, l'admin le lit
 * dans sa vue), le bon code replanifie la cadence et la progression reprend de la même façon
 * jusqu'à l'arrêt suivant puis EXECUTION + dénouement, un mauvais code ne bouge rien, lever
 * (admin) débloque sans code et reprend la cadence, refuser libère la réserve, CUSTOMER ne peut
 * ni agir en staff ni lire la banque d'autrui, le chat est isolé par compte, la photo est
 * plafonnée, et une surcharge du référentiel change l'effectif SANS toucher à la table canonique.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DELAI_NIVEAU_MS, MONTANT_DEMO, REFERENTIEL_CANONIQUE, bicValide, disponibleDe, ibanBEValide, soldeDe,
  type BanqueCompte, type MessageChat, type Referentiel,
} from "@/lib/banque";
import {
  creerCompte, deposerDocument, lireMagasin, notificationsPour, ouvrirSessionServeur, type Magasin, type SessionServeur,
} from "@/lib/serveur";

const cleDemo = "client@kredit.be::CUSTOMER";
import {
  DUREE_CONVERSATION_MS, PHOTO_MAX_OCTETS, actionAdmin, actionClient, apercuPlateforme, avancerEtNotifier, banqueDeSession, chatPour,
  listeComptesClients, ouvrirBanquePour, purgerMessagesChat, referentielPourApi, surchargerReferentiel,
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

  it("une fois vérifié : progression en direct — palier notifié, arrêt à 30 %, codes admin → 60 % puis EXECUTION", () => {
    const magasin = lireMagasin(dossier);
    const session = sessionClient(magasin);
    const admin = sessionAdmin(magasin);
    banqueDeSession(magasin, session); // le portail ouvre la banque à l'affichage (comme le GET réel)
    expect(actionAdmin(magasin, admin, { action: "verifier", compteId: cle, verifie: true }).statut).toBe(200);

    // L'initiation NE PRÉCIPITE rien : le virement part, la cadence est planifiée.
    const r = actionClient(magasin, session, ordre(500, "acompte"));
    expect(r.statut).toBe(200);
    expect(r.modifie).toBe(true);
    const compte = r.corps.compte as BanqueCompte;
    const v = compte.virements[0];
    expect(v.statut).toBe("EN_COURS");
    expect(v.niveau).toBe(0);
    expect(v.prochainNiveauA).toBeDefined();
    expect(v.codeDeblocage).toBeUndefined(); // le code n'est JAMAIS servi au client
    expect(disponibleDe(compte)).toBe(MONTANT_DEMO - 500); // seul le montant est réservé au départ
    expect(soldeDe(compte)).toBe(MONTANT_DEMO); // rien n'est débité avant le dénouement
    const creeA = new Date(v.creeA).getTime();
    const instant = (n: number) => new Date(creeA + n * DELAI_NIVEAU_MS).toISOString();

    // Premier palier confirmé à l'échéance : événement NIVEAU + notification site au client.
    const e1 = avancerEtNotifier(magasin, session.email, "CUSTOMER", instant(1));
    expect(e1.map((e) => e.type)).toEqual(["NIVEAU"]);
    expect(notificationsPour(magasin, session.email).some((n) => n.cle === "banque.vir.notify.level")).toBe(true);

    // Le POINT DE VALIDATION (30 %) arrête la marche : événement ARRET, code émis côté serveur.
    const e2 = avancerEtNotifier(magasin, session.email, "CUSTOMER", instant(2));
    expect(e2.map((e) => e.type)).toEqual(["ARRET"]);
    const dossierBloque = listeComptesClients(magasin).find((x) => x.id === cle)!.compte;
    expect(dossierBloque.virements[0].statut).toBe("BLOQUE");
    expect(dossierBloque.virements[0].niveau).toBe(2);
    expect(disponibleDe(dossierBloque)).toBe(MONTANT_DEMO - 500 - 25); // montant + coût du défaut réservés
    expect(soldeDe(dossierBloque)).toBe(MONTANT_DEMO); // rien n'est débité avant le dénouement

    // Mauvais code : 400, rien ne bouge.
    expect(actionClient(magasin, session, { action: "debloquer", virementId: v.id, code: "FAUX" }))
      .toMatchObject({ statut: 400, corps: { erreur: "code_invalide" }, modifie: false });

    // L'administration lit le code dans sa vue (dossier client) ; le client le saisit → reprise.
    const code1 = listeComptesClients(magasin).find((x) => x.id === cle)!.compte.virements[0].codeDeblocage!;
    expect(code1).toMatch(/^[A-Z0-9]{12}$/); // généré automatiquement : 12 caractères alphanumériques
    const d1 = actionClient(magasin, session, { action: "debloquer", virementId: v.id, code: code1.toLowerCase() });
    expect(d1.statut).toBe(200); // insensible à la casse
    const v1 = (d1.corps.compte as BanqueCompte).virements.find((x) => x.id === v.id)!;
    expect(v1.statut).toBe("EN_COURS"); // la cadence replanifiée : la barre repart au prochain palier
    expect(v1.niveau).toBe(2);
    expect(v1.prochainNiveauA).toBeDefined();

    // La progression reprend de la même façon et rencontre l'arrêt suivant (60 %).
    const reprise = new Date(v1.prochainNiveauA!).getTime();
    const e3 = avancerEtNotifier(magasin, session.email, "CUSTOMER", new Date(reprise).toISOString());
    expect(e3.map((e) => e.type)).toEqual(["ARRET"]);
    const code2 = listeComptesClients(magasin).find((x) => x.id === cle)!.compte.virements[0].codeDeblocage!;
    const d2 = actionClient(magasin, session, { action: "debloquer", virementId: v.id, code: code2 });
    expect(d2.statut).toBe(200);
    const v2 = (d2.corps.compte as BanqueCompte).virements.find((x) => x.id === v.id)!;
    expect(v2.statut).toBe("EN_COURS");
    // Dernier palier : EXECUTION à 100 % + dénouement immédiat (montant + frais des défauts).
    const e4 = avancerEtNotifier(magasin, session.email, "CUSTOMER", v2.prochainNiveauA!);
    expect(e4.map((e) => e.type)).toEqual(["EXECUTION"]);
    const c2 = listeComptesClients(magasin).find((x) => x.id === cle)!.compte;
    expect(c2.virements.find((x) => x.id === v.id)!.statut).toBe("EXECUTE");
    expect(soldeDe(c2)).toBe(MONTANT_DEMO - 500 - 25 - 150);
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

  it("l'arrêt réserve montant + coût ; lever (admin, sans code) reprend la cadence au prochain arrêt", () => {
    const magasin = lireMagasin(dossier);
    const session = sessionClient(magasin);
    const admin = sessionAdmin(magasin);
    banqueDeSession(magasin, session);
    actionAdmin(magasin, admin, { action: "verifier", compteId: cle, verifie: true });
    const r = actionClient(magasin, session, ordre(300, "frais"));
    const v = (r.corps.compte as BanqueCompte).virements[0];
    expect(v.statut).toBe("EN_COURS"); // départ en direct, pas d'arrêt instantané
    const creeA = new Date(v.creeA).getTime();
    const arret = avancerEtNotifier(magasin, session.email, "CUSTOMER", new Date(creeA + 2 * DELAI_NIVEAU_MS).toISOString());
    expect(arret.map((e) => e.type)).toEqual(["NIVEAU", "ARRET"]);
    const compteBloque = listeComptesClients(magasin).find((x) => x.id === cle)!.compte;
    const vb = compteBloque.virements[0];
    expect(vb.statut).toBe("BLOQUE");
    expect(vb.blocages[0]).toMatchObject({ code: "JUSTIF_DOMICILE", cout: 25 });
    expect(disponibleDe(compteBloque)).toBe(MONTANT_DEMO - 300 - 25);

    const rl = actionAdmin(magasin, admin, { action: "lever", compteId: cle, virementId: v.id });
    expect(rl.statut).toBe(200);
    const leve = rl.corps.compte as BanqueCompte;
    const vl = leve.virements.find((x) => x.id === v.id)!;
    expect(vl.statut).toBe("EN_COURS"); // le geste replanifie la cadence…
    expect(vl.niveau).toBe(2);
    expect(vl.prochainNiveauA).toBeDefined();
    // …et le prochain palier rencontre l'arrêt suivant (60 %) : coût levé libéré, nouveau réservé.
    avancerEtNotifier(magasin, session.email, "CUSTOMER", vl.prochainNiveauA!);
    const suite = listeComptesClients(magasin).find((x) => x.id === cle)!.compte;
    const vs = suite.virements.find((x) => x.id === v.id)!;
    expect(vs.statut).toBe("BLOQUE");
    expect(vs.niveau).toBe(3);
    expect(disponibleDe(suite)).toBe(MONTANT_DEMO - 300 - 150);
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
    expect(vuClient).toEqual({ messages: expect.any(Array), purge: false });
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
    // La progression en direct avance jusqu'au prochain point de validation (rattrapage d'échéances).
    const pousser = () => avancerEtNotifier(magasin, session.email, "CUSTOMER", new Date(Date.now() + 3_600_000).toISOString());
    pousser();
    expect(etat().niveau).toBe(2); // premier arrêt : 30 %

    let d = actionClient(magasin, session, { action: "debloquer", virementId: vid, code: lireCode() });
    expect(d.statut).toBe(200);
    pousser(); // la reprise rencontre le champ créé (45 %)
    expect(etat().niveau).toBe(3);
    expect(etat().blocages.filter((b) => !b.leveA)[0]).toMatchObject({ code: "FRAIS_NOTAIRE", cout: 80, motif: "Frais de notaire" });

    d = actionClient(magasin, session, { action: "debloquer", virementId: vid, code: lireCode() });
    pousser();
    expect(etat().niveau).toBe(4); // puis 60 %
    d = actionClient(magasin, session, { action: "debloquer", virementId: vid, code: lireCode() });
    pousser();
    expect(etat().statut).toBe("EXECUTE"); // dernier code : 100 % + dénouement

    // Le compte du client porte une transaction de frais avec le motif défini par l'admin.
    const final = listeComptesClients(magasin).find((x) => x.id === cle)!.compte;
    expect(final.transactions.find((t) => t.motifLibre === "Frais de notaire")).toMatchObject({ sens: "sortant", montant: 80 });
    expect(soldeDe(final)).toBe(MONTANT_DEMO - 400 - 25 - 80 - 150);
  });
});

describe("rétention du chat : une conversation ne vit jamais plus d'une semaine", () => {
  const msg = (id: string, ts: string): MessageChat => ({ id, de: "client", auteur: "X", texte: "t", ts });
  const MAINTENANT = "2026-09-15T12:00:00.000Z";

  it("purge pure : les messages de plus de 7 jours sont effacés, les récents restent", () => {
    // La frontière exacte est MAINTENANT − 7 j = 2026-09-08T12:00:00Z : strictement plus récent = gardé.
    const tropVieux = msg("V1", "2026-09-08T11:59:59.000Z"); // 1 s trop ancien
    const justeBon = msg("V2", "2026-09-08T12:00:01.000Z"); // 1 s dans la fenêtre
    const recent = msg("R1", "2026-09-14T12:00:00.000Z");
    expect(purgerMessagesChat([tropVieux, justeBon, recent], MAINTENANT)).toEqual([justeBon, recent]);
    expect(DUREE_CONVERSATION_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("lecture : la purge s'applique à chaque GET, même sans nouvelle écriture", () => {
    const magasin = lireMagasin(dossier);
    const session = sessionClient(magasin);
    magasin.chats = { [cle]: [msg("V1", "2026-09-01T10:00:00.000Z"), msg("R1", "2026-09-14T10:00:00.000Z")] };
    const r = chatPour(magasin, session, undefined, MAINTENANT);
    expect(r).toEqual({ messages: [expect.objectContaining({ id: "R1" })], purge: true });
    expect(magasin.chats?.[cle]).toHaveLength(1); // l'état en mémoire est nettoyé (l'API persiste)
    // Deuxième lecture : plus rien à purger.
    const relire = chatPour(magasin, session, undefined, MAINTENANT);
    if ("erreur" in relire) throw new Error("lecture attendue");
    expect(relire.purge).toBe(false);
  });

  it("écriture : client comme support purgent avant d'ajouter le nouveau message", () => {
    const magasin = lireMagasin(dossier);
    const session = sessionClient(magasin);
    const admin = sessionAdmin(magasin);
    magasin.chats = { [cle]: [msg("V1", "2026-09-01T10:00:00.000Z")] };
    const rc = actionClient(magasin, session, { action: "chat", texte: "Bonjour" });
    expect(rc.statut).toBe(200);
    expect((rc.corps as { messages: MessageChat[] }).messages.map((m) => m.id)).not.toContain("V1");
    magasin.chats![cle] = [msg("V2", "2026-09-01T10:00:00.000Z")];
    const ra = actionAdmin(magasin, admin, { action: "chat", compteId: cle, texte: "Support, à vous" });
    expect((ra.corps as { messages: MessageChat[] }).messages.map((m) => m.id)).not.toContain("V2");
  });

  it("le staff lit le chat purgé du compte demandé", () => {
    const magasin = lireMagasin(dossier);
    const session = sessionClient(magasin);
    const admin = sessionAdmin(magasin);
    magasin.chats = { [cle]: [msg("V1", "2026-09-01T10:00:00.000Z"), msg("R1", "2026-09-14T10:00:00.000Z")] };
    const r = chatPour(magasin, admin, cle, MAINTENANT) as { messages: MessageChat[]; purge: boolean };
    expect(r.purge).toBe(true);
    expect(r.messages.map((m) => m.id)).toEqual(["R1"]);
    void session;
  });
});

describe("Aperçu de l'administration (slice 22)", () => {
  it("apercuPlateforme agrège clients, KYC, transactions, volumes et un fil trié du plus récent", () => {
    const magasin = lireMagasin(dossier); // sème le client démo « vitrine » (tx, virements, chat)
    const a = apercuPlateforme(magasin);
    expect(a.totaux.clients).toBeGreaterThanOrEqual(1);
    expect(a.totaux.transactions).toBeGreaterThan(0);
    expect(a.totaux.volumeEntrant).toBeGreaterThan(0);
    expect(a.totaux.soldeCumule).toBeGreaterThan(0);
    expect(a.totaux.kycVerifies + a.totaux.kycEnAttente).toBe(a.totaux.clients);
    // Le fil d'activité est trié du plus récent au plus ancien, borné à 30 lignes.
    expect(a.recent.length).toBeGreaterThan(0);
    expect(a.recent.length).toBeLessThanOrEqual(30);
    for (let i = 1; i < a.recent.length; i++) expect(a.recent[i - 1].ts >= a.recent[i].ts).toBe(true);
    // Le client démo est vérifié : au moins un KYC « vérifié » dans le fil.
    expect(a.recent.some((e) => e.type === "kyc" && e.detail === "verifie")).toBe(true);
  });

  it("listeComptesClients remonte pièces en attente et dernier mot du chat (dossier en mains)", () => {
    const magasin = lireMagasin(dossier);
    const session = sessionClient(magasin); // nina@exemple.be
    ouvrirBanquePour(magasin, session.email, session.role, MAINTENANT);
    // Une pièce soumise pour Nina.
    const d = deposerDocument(magasin, {
      email: session.email, demandeId: "KRD-TEST", code: "ID", nom: "carte.png",
      donnees: "data:image/png;base64,xx", taille: 100, maintenant: MAINTENANT,
    });
    expect(d.document).toBeDefined();
    // Le dernier mot du chat revient au client → non lu par le support.
    magasin.chats = { [cle]: [{ id: "M1", de: "client", auteur: "Nina", texte: "Bonjour", ts: MAINTENANT }] };
    const ligne = listeComptesClients(magasin).find((x) => x.id === cle)!;
    expect(ligne.docsEnAttente).toBe(1);
    expect(ligne.chatNonLu).toBe(true);
    // Le support répond : le chat n'est plus « à traiter ».
    magasin.chats = { [cle]: [
      { id: "M1", de: "client", auteur: "Nina", texte: "Bonjour", ts: MAINTENANT },
      { id: "M2", de: "support", auteur: "Support", texte: "À vous", ts: MAINTENANT },
    ] };
    expect(listeComptesClients(magasin).find((x) => x.id === cle)!.chatNonLu).toBe(false);
  });
});
