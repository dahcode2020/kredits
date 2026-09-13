/**
 * @jest-environment node
 */
/**
 * Slice 11 — banque sur l'API : le serveur est la seule autorité.
 *
 * Ce qui est verrouillé : l'ouverture de la banque côté serveur (IBAN BE valide + dotation démo,
 * idempotente), le client n'envoie que des INTENTIONS (un compte non vérifié ne peut pas virer),
 * le pipeline : confirmer × 4 niveaux → EXECUTE + dénouement du solde, le blocage par défaut
 * admin-défini (CERT_ASSURANCE) réserve montant + coût et lever libère, refuser libère la
 * réserve, CUSTOMER ne peut ni agir en staff ni lire la banque d'autrui, le chat est isolé par
 * compte, la photo est plafonnée, et une surcharge du référentiel change l'effectif SANS toucher
 * à la table canonique.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MONTANT_DEMO, REFERENTIEL_CANONIQUE, disponibleDe, ibanBEValide, soldeDe,
  type BanqueCompte,
} from "@/lib/banque";
import {
  creerCompte, lireMagasin, ouvrirSessionServeur, type Magasin, type SessionServeur,
} from "@/lib/serveur";
import {
  PHOTO_MAX_OCTETS, actionAdmin, actionClient, banqueDeSession, chatPour, listeComptesClients,
  ouvrirBanquePour, referentielPourApi, surchargerReferentiel,
} from "@/lib/serveur-banque";

let dossier: string;
beforeEach(() => { dossier = mkdtempSync(join(tmpdir(), "kredit-banque-srv-")); });
afterEach(() => { rmSync(dossier, { recursive: true, force: true }); });

const MAINTENANT = "2026-09-14T10:00:00.000Z";
const BENEF = { nom: "Garage Central", iban: "BE68539007547034" }; // exemple publié par Febelfin

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
    const r = actionClient(magasin, session, { action: "virement", beneficiaireNom: BENEF.nom, beneficiaireIban: BENEF.iban, montant: 500, motif: "acompte" });
    expect(r.statut).toBe(400);
    expect(r.corps.erreur).toBe("non_verifie");
    expect(r.modifie).toBe(false);
  });

  it("une fois vérifié : virement EN_COURS + réserve, puis confirmer × 4 → EXECUTE et solde débité", () => {
    const magasin = lireMagasin(dossier);
    const session = sessionClient(magasin);
    const admin = sessionAdmin(magasin);
    banqueDeSession(magasin, session); // le portail ouvre la banque à l'affichage (comme le GET réel)
    expect(actionAdmin(magasin, admin, { action: "verifier", compteId: cle, verifie: true }).statut).toBe(200);

    const r = actionClient(magasin, session, { action: "virement", beneficiaireNom: BENEF.nom, beneficiaireIban: BENEF.iban, montant: 500, motif: "acompte" });
    expect(r.statut).toBe(200);
    expect(r.modifie).toBe(true);
    const compte = r.corps.compte as BanqueCompte;
    const v = compte.virements[0];
    expect(v.statut).toBe("EN_COURS");
    expect(v.niveau).toBe(0);
    expect(disponibleDe(compte)).toBe(MONTANT_DEMO - 500); // réservé, pas encore débité
    expect(soldeDe(compte)).toBe(MONTANT_DEMO);

    let actuel = compte;
    for (let i = 1; i <= 4; i += 1) {
      const rc = actionAdmin(magasin, admin, { action: "confirmer", compteId: cle, virementId: v.id });
      expect(rc.statut).toBe(200);
      actuel = rc.corps.compte as BanqueCompte;
      const va = actuel.virements.find((x) => x.id === v.id)!;
      expect(va.niveau).toBe(i);
    }
    const final = actuel.virements.find((x) => x.id === v.id)!;
    expect(final.statut).toBe("EXECUTE");
    expect(soldeDe(actuel)).toBe(MONTANT_DEMO - 500); // dénouement : le solde bouge à la fin
    expect(disponibleDe(actuel)).toBe(MONTANT_DEMO - 500); // réserve libérée
    // Un virement exécuté n'est plus confirmable.
    expect(actionAdmin(magasin, admin, { action: "confirmer", compteId: cle, virementId: v.id }).statut).toBe(400);
  });

  it("bloquer par CERT_ASSURANCE réserve montant + coût ; lever récupère le coût", () => {
    const magasin = lireMagasin(dossier);
    const session = sessionClient(magasin);
    const admin = sessionAdmin(magasin);
    banqueDeSession(magasin, session);
    actionAdmin(magasin, admin, { action: "verifier", compteId: cle, verifie: true });
    const r = actionClient(magasin, session, { action: "virement", beneficiaireNom: BENEF.nom, beneficiaireIban: BENEF.iban, montant: 300, motif: "frais" });
    const v = (r.corps.compte as BanqueCompte).virements[0];

    const rb = actionAdmin(magasin, admin, { action: "bloquer", compteId: cle, virementId: v.id, codeDefaut: "CERT_ASSURANCE" });
    expect(rb.statut).toBe(200);
    const bloque = rb.corps.compte as BanqueCompte;
    const vb = bloque.virements.find((x) => x.id === v.id)!;
    expect(vb.statut).toBe("BLOQUE");
    expect(vb.blocages[0]).toMatchObject({ code: "CERT_ASSURANCE", cout: 150 });
    expect(disponibleDe(bloque)).toBe(MONTANT_DEMO - 300 - 150);

    const rl = actionAdmin(magasin, admin, { action: "lever", compteId: cle, virementId: v.id });
    expect(rl.statut).toBe(200);
    const leve = rl.corps.compte as BanqueCompte;
    expect(leve.virements.find((x) => x.id === v.id)!.statut).toBe("EN_COURS");
    expect(disponibleDe(leve)).toBe(MONTANT_DEMO - 300); // coût libéré, montant toujours réservé
  });

  it("refuser libère toute la réserve ; annuler reste un droit du client tant que c'est vivant", () => {
    const magasin = lireMagasin(dossier);
    const session = sessionClient(magasin);
    const admin = sessionAdmin(magasin);
    banqueDeSession(magasin, session);
    actionAdmin(magasin, admin, { action: "verifier", compteId: cle, verifie: true });
    const r = actionClient(magasin, session, { action: "virement", beneficiaireNom: BENEF.nom, beneficiaireIban: BENEF.iban, montant: 200, motif: "test" });
    const v = (r.corps.compte as BanqueCompte).virements[0];

    const rf = actionAdmin(magasin, admin, { action: "refuser", compteId: cle, virementId: v.id });
    expect(rf.statut).toBe(200);
    const refuse = rf.corps.compte as BanqueCompte;
    expect(refuse.virements.find((x) => x.id === v.id)!.statut).toBe("REFUSE");
    expect(disponibleDe(refuse)).toBe(MONTANT_DEMO);

    // Annulation par le client sur un second virement encore EN_COURS.
    const r2 = actionClient(magasin, session, { action: "virement", beneficiaireNom: BENEF.nom, beneficiaireIban: BENEF.iban, montant: 100, motif: "x" });
    const v2 = (r2.corps.compte as BanqueCompte).virements.find((x) => x.statut === "EN_COURS")!;
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
});
