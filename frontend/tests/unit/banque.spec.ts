/**
 * @jest-environment node
 */
/**
 * Slice 8 — banque locale de démonstration : verrous.
 *
 * Ce qui est verrouillé : l'IBAN fictif est formellement valide (ISO 7064), le ledger ne bouge
 * qu'au dénouement, et la machine à états du pipeline suit le référentiel canonique
 * (operations/virements.json) — un virement bloqué pour défaut s'arrête exactement au niveau
 * atteint, avec le code et le coût du référentiel.
 */
import {
  LONGUEURS_IBAN, MONTANT_DEMO, REFERENTIEL_CANONIQUE, annulerVirement, arretsActifs,
  debloquerParCode, denouer, disponibleDe, evolutionVirement, genererIbanBE, ibanBEValide,
  ibanValide, initierVirement, leverBlocage, ouvrirBanqueClient, progressionDe,
  referentielEffectif, refuserVirement, reserveDe, soldeDe, type BanqueCompte,
} from "@/lib/banque";

const MAINTENANT = "2026-09-13T10:00:00.000Z";
const ref = REFERENTIEL_CANONIQUE;

const compteVerifie = (): BanqueCompte => ({
  ...ouvrirBanqueClient("cliente@exemple.be", "CUSTOMER", MAINTENANT),
  verifie: true,
});

describe("IBAN fictif, mais formellement valide", () => {
  it("l'IBAN généré passe la checksum ISO 7064 (mod 97 = 1)", () => {
    const iban = genererIbanBE("cliente@exemple.be::CUSTOMER");
    expect(iban).toMatch(/^BE\d{14}$/);
    expect(ibanBEValide(iban)).toBe(true);
  });

  it("déterministe : même compte → même IBAN ; autre compte → autre IBAN", () => {
    expect(genererIbanBE("a@exemple.be::CUSTOMER")).toBe(genererIbanBE("a@exemple.be::CUSTOMER"));
    expect(genererIbanBE("a@exemple.be::CUSTOMER")).not.toBe(genererIbanBE("b@exemple.be::CUSTOMER"));
  });

  it("des IBAN proches mais faux sont refusés (checksum, pas juste le format)", () => {
    const iban = genererIbanBE("cliente@exemple.be::CUSTOMER");
    const faux = iban.slice(0, 15) + (iban[15] === "9" ? "0" : "9");
    expect(ibanBEValide(faux)).toBe(false);
    expect(ibanBEValide("BE68539007547034")).toBe(true); // exemple publié par Febelfin
    expect(ibanBEValide("FR1420041010050500013M02606")).toBe(false); // pas BE
  });
});

describe("IBAN international : le bénéficiaire peut être dans n'importe quel pays", () => {
  // Exemples publiés par le registre officiel (espaces tolérés à la saisie).
  const VALIDES = [
    "BE68539007547034",                     // Belgique
    "FR1420041010050500013M02606",          // France
    "DE89370400440532013000",               // Allemagne
    "NL91ABNA0417164300",                   // Pays-Bas
    "GB29NWBK60161331926819",               // Royaume-Uni
    "ES9121000418450200051332",             // Espagne
    "LU280019400644750000",                 // Luxembourg
    "CH9300762011623852957",                // Suisse
    "FR14 2004 1010 0505 0001 3M02 606",    // avec espaces
  ];
  it.each(VALIDES)("accepte un IBAN valide : %s", (iban) => {
    expect(ibanValide(iban)).toBe(true);
  });

  it("refuse : mauvaise checksum, mauvaise longueur, pays inconnu, charabia", () => {
    expect(ibanValide("FR1420041010050500013M02607")).toBe(false); // checksum cassée d'un chiffre
    expect(ibanValide("DE8937040044053201300")).toBe(false);        // un chiffre de trop en moins
    expect(ibanValide("XX9300762011623852957")).toBe(false);        // code pays hors registre
    expect(ibanValide("BE68")).toBe(false);                          // trop court
    expect(ibanValide("")).toBe(false);
    expect(ibanValide("pas-un-iban")).toBe(false);
  });

  it("le registre couvre les longueurs officielles (BE 16, FR 27, DE 22, GB 22, NL 18…)", () => {
    expect(LONGUEURS_IBAN.BE).toBe(16);
    expect(LONGUEURS_IBAN.FR).toBe(27);
    expect(LONGUEURS_IBAN.DE).toBe(22);
    expect(LONGUEURS_IBAN.GB).toBe(22);
    expect(LONGUEURS_IBAN.NL).toBe(18);
    expect(Object.keys(LONGUEURS_IBAN).length).toBeGreaterThanOrEqual(80);
  });

  it("initierVirement accepte un bénéficiaire hors Belgique et normalise l'IBAN", () => {
    const { compte, erreur } = initierVirement(
      compteVerifie(), "Fournisseur Lyon", "FR14 2004 1010 0505 0001 3M02 606", 250, "Facture", MAINTENANT,
      { adresse: "12 rue de la République, 69001 Lyon", bic: "BNPAFRPP" },
    );
    expect(erreur).toBeUndefined();
    expect(compte.virements[0].beneficiaireIban).toBe("FR1420041010050500013M02606");
  });

  it("initierVirement refuse toujours un IBAN international invalide", () => {
    const { erreur } = initierVirement(compteVerifie(), "X", "FR1420041010050500013M02607", 100, "x", MAINTENANT);
    expect(erreur).toBe("iban_invalide");
  });
});

describe("ouverture de compte", () => {
  it("la dotation de démonstration est le seul mouvement initial, et le solde la reflète", () => {
    const compte = ouvrirBanqueClient("cliente@exemple.be", "CUSTOMER", MAINTENANT);
    expect(compte.transactions).toHaveLength(1);
    expect(compte.transactions[0].sens).toBe("entrant");
    expect(compte.transactions[0].montant).toBe(MONTANT_DEMO);
    expect(compte.transactions[0].motifCle).toBe("banque.tx.demoGrant");
    expect(compte.verifie).toBe(false);
    expect(soldeDe(compte)).toBe(MONTANT_DEMO);
    expect(disponibleDe(compte)).toBe(MONTANT_DEMO);
  });
});

describe("virement sortant : garde-fous", () => {
  const BENEF = { nom: "Garage Central", iban: "BE68539007547034" };

  it("un compte non vérifié ne peut pas initier de virement", () => {
    const compte = ouvrirBanqueClient("x@exemple.be", "CUSTOMER", MAINTENANT);
    const { erreur } = initierVirement(compte, BENEF.nom, BENEF.iban, 500, "Acompte", MAINTENANT);
    expect(erreur).toBe("non_verifie");
  });

  it("IBAN invalide et montant excessif sont refusés", () => {
    const compte = compteVerifie();
    expect(initierVirement(compte, BENEF.nom, "BE00000000000000", 500, "x", MAINTENANT).erreur).toBe("iban_invalide");
    expect(initierVirement(compte, BENEF.nom, BENEF.iban, MONTANT_DEMO + 1, "x", MAINTENANT).erreur).toBe("montant_invalide");
    expect(initierVirement(compte, BENEF.nom, BENEF.iban, 0, "x", MAINTENANT).erreur).toBe("montant_invalide");
  });

  it("un virement initié réserve son montant : le disponible baisse, le solde ne bouge pas", () => {
    const { compte } = initierVirement(compteVerifie(), BENEF.nom, BENEF.iban, 1_000, "Acompte", MAINTENANT);
    expect(compte.virements).toHaveLength(1);
    expect(soldeDe(compte)).toBe(MONTANT_DEMO);
    expect(reserveDe(compte.virements)).toBe(1_000);
    expect(disponibleDe(compte)).toBe(MONTANT_DEMO - 1_000);
  });
});

describe("pipeline auto-évolutif à codes (référentiel canonique)", () => {
  const BENEF = { nom: "Garage Central", iban: "BE68539007547034" };
  const virId = (c: BanqueCompte) => c.virements[0].id;

  const initier = () => initierVirement(compteVerifie(), BENEF.nom, BENEF.iban, 1_200, "Acompte", MAINTENANT).compte;

  it("référentiel : niveaux 10/30/60/100 ; arrêts actifs à 30 % puis 60 %", () => {
    expect(ref.pipeline.map((n) => n.pct)).toEqual([10, 30, 60, 100]);
    expect(arretsActifs(ref).map((a) => a.pct)).toEqual([30, 60]);
  });

  it("l'évolution arrête la barre au premier défaut actif (30 %), avec code et coût en réserve", () => {
    const compte0 = initier();
    const compte = evolutionVirement(compte0, virId(compte0), ref, "CODE30", MAINTENANT);
    const v = compte.virements[0];
    expect(v.statut).toBe("BLOQUE");
    expect(progressionDe(v, ref)).toBe(30);
    expect(v.codeDeblocage).toBe("CODE30");
    expect(v.blocages.map((b) => b.code)).toEqual(["JUSTIF_DOMICILE"]);
    expect(reserveDe(compte.virements)).toBe(1_200 + 25);
  });

  it("mauvais code : rien ne bouge ; bon code (insensible à la casse) : la barre repart et s'arrête à 60 %", () => {
    let compte = initier();
    const id = virId(compte);
    compte = evolutionVirement(compte, id, ref, "CODE30", MAINTENANT);
    expect(debloquerParCode(compte, id, "FAUX", MAINTENANT).ok).toBe(false);
    expect(debloquerParCode(compte, id, "FAUX", MAINTENANT).compte.virements[0].statut).toBe("BLOQUE");
    const r = debloquerParCode(compte, id, "code30", MAINTENANT);
    expect(r.ok).toBe(true);
    compte = evolutionVirement(r.compte, id, ref, "CODE60", MAINTENANT);
    const v = compte.virements[0];
    expect(v.statut).toBe("BLOQUE");
    expect(progressionDe(v, ref)).toBe(60);
    expect(v.blocages.filter((b) => !b.leveA).map((b) => b.code)).toEqual(["CERT_ASSURANCE"]);
    expect(v.blocages.find((b) => b.code === "JUSTIF_DOMICILE")?.leveA).toBe(MAINTENANT);
  });

  it("dernier déblocage : barre à 100 %, EXECUTE, dénouement montant + frais des défauts", () => {
    let compte = initier();
    const id = virId(compte);
    compte = evolutionVirement(compte, id, ref, "A", MAINTENANT);
    compte = debloquerParCode(compte, id, "A", MAINTENANT).compte;
    compte = evolutionVirement(compte, id, ref, "B", MAINTENANT);
    compte = debloquerParCode(compte, id, "B", MAINTENANT).compte;
    compte = evolutionVirement(compte, id, ref, "C", MAINTENANT);
    expect(compte.virements[0].statut).toBe("EXECUTE");
    compte = denouer(compte, id, MAINTENANT);
    expect(soldeDe(compte)).toBe(MONTANT_DEMO - 1_200 - 25 - 150);
    expect(reserveDe(compte.virements)).toBe(0);
    // Dénouement en trois transactions : le montant, puis un frais par défaut avec SON motif de paiement.
    expect(compte.transactions.slice(-3).map((t) => t.montant)).toEqual([1_200, 25, 150]);
    expect(compte.transactions.at(-1)).toMatchObject({ sens: "sortant", montant: 150, motifLibre: "banque:defaut.CERT_ASSURANCE" });
    expect(soldeDe(denouer(compte, id, MAINTENANT))).toBe(soldeDe(compte)); // idempotent
  });

  it("sans défaut actif au-delà du niveau courant, l'évolution exécute directement", () => {
    const refLibre = referentielEffectif({ JUSTIF_DOMICILE: { actif: false }, CERT_ASSURANCE: { actif: false } });
    const compte0 = initier();
    const compte = evolutionVirement(compte0, virId(compte0), refLibre, "X", MAINTENANT);
    expect(compte.virements[0].statut).toBe("EXECUTE");
  });

  it("l'admin crée un champ de progression : nouveau niveau dans la barre, arrêt et motif propres", () => {
    const refEtendu = referentielEffectif({ FRAIS_NOTAIRE: { cree: true, pct: 45, cout: 80, actif: true, motif: "Frais de notaire" } });
    expect(refEtendu.pipeline.map((n) => n.pct)).toEqual([10, 30, 45, 60, 100]);
    expect(arretsActifs(refEtendu).map((a) => a.pct)).toEqual([30, 45, 60]);
    const compte0 = initier();
    let compte = evolutionVirement(compte0, virId(compte0), refEtendu, "K", MAINTENANT);
    expect(compte.virements[0].statut).toBe("BLOQUE");
    expect(progressionDe(compte.virements[0], refEtendu)).toBe(30);
    compte = debloquerParCode(compte, virId(compte), "K", MAINTENANT).compte;
    compte = evolutionVirement(compte, virId(compte), refEtendu, "L", MAINTENANT);
    const v = compte.virements[0];
    expect(progressionDe(v, refEtendu)).toBe(45);
    expect(v.blocages.filter((b) => !b.leveA)[0]).toMatchObject({ code: "FRAIS_NOTAIRE", cout: 80, motif: "Frais de notaire" });
  });

  it("lever (geste d'administration) débloque sans code, puis la machine repart au prochain arrêt", () => {
    let compte = initier();
    const id = virId(compte);
    compte = evolutionVirement(compte, id, ref, "A", MAINTENANT);
    compte = leverBlocage(compte, id, MAINTENANT);
    expect(compte.virements[0].statut).toBe("EN_COURS");
    compte = evolutionVirement(compte, id, ref, "B", MAINTENANT);
    expect(compte.virements[0].statut).toBe("BLOQUE");
    expect(progressionDe(compte.virements[0], ref)).toBe(60);
  });

  it("refus et annulation libèrent la réserve sans toucher au solde", () => {
    let compte = refuserVirement(initier(), "");
    expect(compte.virements[0].statut).toBe("EN_COURS"); // id vide : rien ne se passe
    compte = refuserVirement(compte, virId(compte));
    expect(compte.virements[0].statut).toBe("REFUSE");
    expect(soldeDe(compte)).toBe(MONTANT_DEMO);
    expect(disponibleDe(compte)).toBe(MONTANT_DEMO);
    const c2 = initier();
    const c3 = annulerVirement(c2, c2.virements[0].id);
    expect(c3.virements[0].statut).toBe("ANNULE");
    expect(soldeDe(c3)).toBe(MONTANT_DEMO);
  });
});
