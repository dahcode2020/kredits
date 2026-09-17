/**
 * Verrous du document de prêt « LOAN AGREEMENT » (lib/contrat-doc) : nombres en lettres,
 * date au format du document, placeholders, emprunteur automatique, annexe et rendu HTML.
 */
import {
  CORPS_CONTRAT_DEFAUT, PRETEUR_DEFAUT, dateContratEn, decouperCorps, emprunteurDe,
  lignesEcheancierContrat, mensualiteContrat, montantEnLettresEn, rendreHtmlContrat,
  substituerPlaceholders, varsContrat,
} from "@/lib/contrat-doc";

describe("contrat-doc : nombres en lettres anglais", () => {
  it("cas bornes et composés", () => {
    expect(montantEnLettresEn(0)).toBe("zero");
    expect(montantEnLettresEn(21)).toBe("twenty-one");
    expect(montantEnLettresEn(100)).toBe("one hundred");
    expect(montantEnLettresEn(755_000)).toBe("seven hundred fifty-five thousand");
    expect(montantEnLettresEn(1_000_000)).toBe("one million");
    expect(montantEnLettresEn(1_234_567)).toBe("one million two hundred thirty-four thousand five hundred sixty-seven");
    expect(montantEnLettresEn(-5)).toBe("zero");
  });
});

describe("contrat-doc : date du document", () => {
  it("ordinaux anglais (1er/2/3/4/21)", () => {
    expect(dateContratEn("2026-09-03T10:00:00.000Z")).toBe("3rd September 2026");
    expect(dateContratEn("2026-09-01T10:00:00.000Z")).toBe("1st September 2026");
    expect(dateContratEn("2026-09-02T10:00:00.000Z")).toBe("2nd September 2026");
    expect(dateContratEn("2026-09-04T10:00:00.000Z")).toBe("4th September 2026");
    expect(dateContratEn("2026-09-21T10:00:00.000Z")).toBe("21st September 2026");
    expect(dateContratEn("pas-une-date")).toBe("pas-une-date");
  });
});

describe("contrat-doc : placeholders remplis depuis le contrat", () => {
  const contrat = { montant: 755_000, objet: "Real Estate Works", tauxAnnuel: 1.5, dureeMois: 240, reference: "006689TE/CI/0035" };
  it("montant en lettres + nombre, objet, taux, mensualités", () => {
    const vars = varsContrat(contrat);
    expect(vars.LOAN_AMOUNT_WORDS).toBe("Seven hundred fifty-five thousand");
    expect(vars.LOAN_AMOUNT).toBe("755,000");
    expect(vars.PURPOSE).toBe("Real Estate Works");
    expect(vars.INTEREST_RATE).toBe("1.5");
    expect(vars.INSTALLMENTS).toBe("240");
    const rendu = substituerPlaceholders(CORPS_CONTRAT_DEFAUT, vars);
    expect(rendu).toContain("Seven hundred fifty-five thousand euros (755,000 EUR)");
    expect(rendu).toContain("fixed annual rate of 1.5% per annum");
    expect(rendu).toContain("repay the Loan in 240 constant successive installments");
    expect(rendu).not.toContain("{{LOAN_AMOUNT");
  });
  it("les clés inconnues restent telles quelles", () => {
    expect(substituerPlaceholders("x {{INCONNU}} y", {})).toBe("x {{INCONNU}} y");
  });
});

describe("contrat-doc : emprunteur recomposé depuis le profil", () => {
  it("profil complet → nom, téléphone, adresse", () => {
    const e = emprunteurDe("Client KREDIT", "client@kredit.be", {
      prenom: "Client", nom: "KREDIT", rue: "Rue des Bruyères", numero: "42", boite: "b3",
      codePostal: "1050", ville: "Ixelles", pays: "Belgique", telephone: "+32 470 12 34 56",
    });
    expect(e.nom).toBe("Client KREDIT");
    expect(e.telephone).toBe("+32 470 12 34 56");
    expect(e.adresse).toBe("Rue des Bruyères 42 b3, 1050 Ixelles, Belgique");
  });
  it("profil absent → repli sur le nom du compte, champs vides", () => {
    const e = emprunteurDe("Jean Dupont", "jean@exemple.be", null);
    expect(e.nom).toBe("Jean Dupont");
    expect(e.telephone).toBe("");
    expect(e.adresse).toBe("");
  });
});

describe("contrat-doc : échéancier d'annexe", () => {
  it("nombre de lignes, dernière ligne à zéro, mensualité cohérente", () => {
    const lignes = lignesEcheancierContrat(15_000, 48, 2.5, "2026-09-13T10:00:00.000Z");
    expect(lignes).toHaveLength(48);
    expect(lignes[0].mensualite).toBeCloseTo(328.71, 1);
    expect(lignes[47].capitalRestant).toBe(0);
    expect(lignes[0].date).toBe("2026-10-13T10:00:00.000Z");
  });
  it("entrées invalides → aucune ligne", () => {
    expect(lignesEcheancierContrat(0, 12, 5, "2026-01-01T00:00:00.000Z")).toEqual([]);
  });
});

describe("contrat-doc : rendu HTML autonome", () => {
  const base = {
    id: "CTR-1", reference: "006689TE/CI/0035", montant: 755_000, dureeMois: 240, tauxAnnuel: 1.5,
    mensualite: mensualiteContrat(755_000, 240, 1.5), objet: "Real Estate Works",
    creeA: "2026-09-03T10:00:00.000Z", majA: "2026-09-03T10:00:00.000Z",
  };
  const html = rendreHtmlContrat({
    contrat: base,
    emprunteur: { nom: "FRANK FORGER", email: "hypostore24@hotmail.com", telephone: "+4917656918849", adresse: "Ringstraße 14 Germany" },
    preteur: PRETEUR_DEFAUT, corps: CORPS_CONTRAT_DEFAUT, logoSrc: "data:image/png;base64,QUJD", mentions: ["Clause spéciale <b>"],
  });
  it("entête logo + référence + date", () => {
    expect(html).toContain("<img src=\"data:image/png;base64,QUJD\"");
    expect(html).toContain("Reference Number: 006689TE/CI/0035");
    expect(html).toContain("Date: 3rd September 2026");
  });
  it("emprunteur automatique présent", () => {
    expect(html).toContain("FRANK FORGER");
    expect(html).toContain("hypostore24@hotmail.com");
    expect(html).toContain("Ringstraße 14 Germany");
  });
  it("annexe : données du crédit + échéancier complet", () => {
    expect(html).toContain("Annexe — Credit Data");
    expect(html).toContain("755,000.00 EUR");
    expect(html).toContain("Annexe — Repayment Schedule");
    expect(html).toContain("240 monthly installments");
  });
  it("échappement du contenu saisi (mentions, prêteur)", () => {
    expect(html).toContain("Clause spéciale &lt;b&gt;");
    expect(html).not.toContain("Clause spéciale <b>");
  });
  it("le corps découpé traite les ARTICLE comme titres", () => {
    const blocs = decouperCorps(CORPS_CONTRAT_DEFAUT);
    expect(blocs.filter((b) => b.type === "titre").length).toBeGreaterThanOrEqual(12);
    expect(html).toContain("ARTICLE 10: GOVERNING LAW AND DISPUTE RESOLUTION");
  });
});
