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
  MONTANT_DEMO, REFERENTIEL_CANONIQUE, annulerVirement, bloquerVirement, confirmerNiveau,
  denouer, disponibleDe, genererIbanBE, ibanBEValide, initierVirement, leverBlocage,
  ouvrirBanqueClient, progressionDe, referentielEffectif, refuserVirement, reserveDe, soldeDe,
  type BanqueCompte,
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

describe("pipeline de validation (référentiel canonique)", () => {
  const BENEF = { nom: "Garage Central", iban: "BE68539007547034" };
  const virId = (c: BanqueCompte) => c.virements[0].id;

  const initier = () => initierVirement(compteVerifie(), BENEF.nom, BENEF.iban, 1_200, "Acompte", MAINTENANT).compte;

  it("la progression suit les pct du référentiel, niveau confirmé par niveau", () => {
    expect(ref.pipeline.map((n) => n.pct)).toEqual([10, 30, 60, 100]);
    let compte = initier();
    expect(progressionDe(compte.virements[0], ref)).toBe(0);
    compte = confirmerNiveau(compte, virId(compte), ref);
    expect(compte.virements[0].statut).toBe("EN_COURS");
    expect(progressionDe(compte.virements[0], ref)).toBe(10);
    compte = confirmerNiveau(compte, virId(compte), ref);
    expect(progressionDe(compte.virements[0], ref)).toBe(30);
  });

  it("un blocage arrête le virement exactement au niveau atteint, avec code et coût du référentiel", () => {
    let compte = initier();
    compte = confirmerNiveau(compte, virId(compte), ref); // 10 %
    compte = confirmerNiveau(compte, virId(compte), ref); // 30 %
    compte = bloquerVirement(compte, virId(compte), "CERT_ASSURANCE", ref, MAINTENANT);
    const v = compte.virements[0];
    expect(v.statut).toBe("BLOQUE");
    expect(progressionDe(v, ref)).toBe(30);
    expect(v.blocages).toEqual([{ code: "CERT_ASSURANCE", cout: 150, depuis: MAINTENANT, leveA: undefined }]);
    // Bloqué : plus aucune confirmation possible.
    expect(confirmerNiveau(compte, virId(compte), ref).virements[0].statut).toBe("BLOQUE");
    // La réserve inclut le coût du défaut.
    expect(reserveDe(compte.virements)).toBe(1_200 + 150);
  });

  it("un défaut inactif ou inconnu ne bloque pas", () => {
    const compte = initier();
    const surcharge = referentielEffectif({ CAPACITE_INSUFFISANTE: { actif: false } });
    expect(bloquerVirement(compte, virId(compte), "CAPACITE_INSUFFISANTE", surcharge, MAINTENANT).virements[0].statut).toBe("EN_COURS");
    expect(bloquerVirement(compte, virId(compte), "INCONNU", ref, MAINTENANT).virements[0].statut).toBe("EN_COURS");
  });

  it("lever le blocage repart du même niveau ; le dénouement débite montant + frais et libère la réserve", () => {
    let compte = initier();
    compte = confirmerNiveau(compte, virId(compte), ref);
    compte = bloquerVirement(compte, virId(compte), "CERT_ASSURANCE", ref, MAINTENANT);
    compte = leverBlocage(compte, virId(compte), MAINTENANT);
    expect(compte.virements[0].statut).toBe("EN_COURS");
    expect(progressionDe(compte.virements[0], ref)).toBe(10);
    compte = confirmerNiveau(compte, virId(compte), ref);  // 30
    compte = confirmerNiveau(compte, virId(compte), ref);  // 60
    compte = confirmerNiveau(compte, virId(compte), ref);  // 100 → EXECUTE
    expect(compte.virements[0].statut).toBe("EXECUTE");
    compte = denouer(compte, virId(compte), MAINTENANT);
    expect(soldeDe(compte)).toBe(MONTANT_DEMO - 1_200 - 150);
    expect(reserveDe(compte.virements)).toBe(0);
    expect(compte.transactions.at(-1)).toMatchObject({ sens: "sortant", montant: 1_350 });
    // Idempotent : dénouer deux fois ne débite pas deux fois.
    expect(soldeDe(denouer(compte, virId(compte), MAINTENANT))).toBe(soldeDe(compte));
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
