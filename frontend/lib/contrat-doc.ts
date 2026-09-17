/**
 * Document de prêt « LOAN AGREEMENT » — module PUR, isomorphe (aucun import Node) :
 * importé par l'UI d'administration (aperçu + téléchargement), par le menu Échéanciers
 * (mêmes calculs) et par les verrous jest. Une seule implémentation de l'annuité :
 * `serveur.ts` RÉ-EXPORTE `mensualiteContrat` d'ici, jamais l'inverse.
 *
 * Le corps du contrat est un texte éditable par l'administration ; les données du crédit
 * y entrent par des PLACEHOLDERS `{{CLE}}` remplis automatiquement, et l'emprunteur est
 * recomposé à chaque rendu depuis le profil du client (jamais figé dans le texte).
 */

/** Bornes du contenu éditable du contrat — partagées serveur (validation) et navigateur (UI). */
export const CONTRAT_CORPS_MAX = 100_000;
export const CONTRAT_PRETEUR_MAX = 4_000;
export const CONTRAT_REFERENCE_MAX = 60;
export const CONTRAT_LOGO_MAX = 900_000; // caractères de dataURL ≈ 660 Ko binaires
export const LOGO_DATAURL_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
export function logoDataUrlValide(s: string): boolean { return s.length <= CONTRAT_LOGO_MAX && LOGO_DATAURL_RE.test(s); }

export interface Emprunteur { nom: string; email: string; telephone: string; adresse: string }
export interface LigneEcheancier { mois: number; date: string; mensualite: number; capitalRestant: number }
export interface BlocCorps { type: "titre" | "paragraphe"; texte: string }

/* ------------------------------------------------------------------ mathématique du crédit */

/** Annuité constante : P·r/(1−(1+r)^−n), r = taux annuel % / 1200 ; taux nul = P/n. Deux décimales. */
export function mensualiteContrat(montant: number, dureeMois: number, tauxAnnuel: number): number {
  if (!Number.isFinite(montant) || montant <= 0) return 0;
  if (!Number.isInteger(dureeMois) || dureeMois <= 0) return 0;
  if (!Number.isFinite(tauxAnnuel) || tauxAnnuel < 0) return 0;
  const r = tauxAnnuel / 100 / 12;
  const brute = r === 0 ? montant / dureeMois : (montant * r) / (1 - Math.pow(1 + r, -dureeMois));
  return Math.round(brute * 100) / 100;
}

/** Échéance n° i d'un contrat créé à `origineISO` : origine + i mois (calendaire, UTC). */
export function echeanceDe(origineISO: string, i: number): string {
  const d = new Date(origineISO);
  d.setUTCMonth(d.getUTCMonth() + i);
  return d.toISOString();
}

/** Échéancier complet d'un contrat : chaque mois, la mensualité et le capital restant dû. */
export function lignesEcheancierContrat(montant: number, dureeMois: number, tauxAnnuel: number, origineISO: string): LigneEcheancier[] {
  const m = mensualiteContrat(montant, dureeMois, tauxAnnuel);
  if (m <= 0 || !Number.isInteger(dureeMois) || dureeMois <= 0) return [];
  const r = tauxAnnuel / 100 / 12;
  const lignes: LigneEcheancier[] = [];
  let capital = montant;
  for (let i = 1; i <= dureeMois; i++) {
    const interets = capital * r;
    const amortissement = Math.min(m - interets, capital);
    capital = Math.max(0, capital - amortissement);
    // Dernière échéance : le centime d'écart d'arrondi de l'annuité est soldé — capital restant 0.
    lignes.push({ mois: i, date: echeanceDe(origineISO, i), mensualite: m, capitalRestant: i === dureeMois ? 0 : Math.round(capital * 100) / 100 });
  }
  return lignes;
}

/* ------------------------------------------------------------------ nombre en lettres (EN) */

const UNITES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const DIZAINES = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const ECHELLES = ["", " thousand", " million", " billion", " trillion"];

function troisChiffresEn(n: number): string {
  const mots: string[] = [];
  const cent = Math.floor(n / 100);
  const reste = n % 100;
  if (cent) mots.push(`${UNITES[cent]} hundred`);
  if (reste) {
    if (reste < 20) mots.push(UNITES[reste]);
    else {
      const d = DIZAINES[Math.floor(reste / 10)];
      const u = reste % 10;
      mots.push(u ? `${d}-${UNITES[u]}` : d);
    }
  }
  return mots.join(" ");
}

/** Montant entier en lettres anglaises (« seven hundred fifty-five thousand »). Borné à 10^15−1. */
export function montantEnLettresEn(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "zero";
  const entier = Math.floor(n);
  if (entier === 0) return "zero";
  if (entier >= 1e15) return String(entier);
  const groupes: number[] = [];
  let reste = entier;
  while (reste > 0) { groupes.push(reste % 1000); reste = Math.floor(reste / 1000); }
  const mots: string[] = [];
  for (let i = groupes.length - 1; i >= 0; i--) {
    if (!groupes[i]) continue;
    mots.push(troisChiffresEn(groupes[i]) + ECHELLES[i]);
  }
  return mots.join(" ");
}

/** Date du contrat au format du document : « 3rd September 2026 ». */
export function dateContratEn(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const mois = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const j = d.getUTCDate();
  const suffixe = j % 100 >= 11 && j % 100 <= 13 ? "th" : j % 10 === 1 ? "st" : j % 10 === 2 ? "nd" : j % 10 === 3 ? "rd" : "th";
  return `${j}${suffixe} ${mois[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/* ------------------------------------------------------------------ emprunteur automatique */

/** Recompose l'emprunteur depuis le compte + profil du client (mise à jour automatique). */
export function emprunteurDe(
  nomCompte: string, email: string, profil: Record<string, string> | null | undefined,
): Emprunteur {
  const p = profil ?? {};
  const nom = [p.prenom, p.nom].filter((x) => x && x.trim()).join(" ").trim() || nomCompte;
  const rue = [p.rue, p.numero, p.boite].filter((x) => x && x.trim()).join(" ").trim();
  const ville = [p.codePostal, p.ville].filter((x) => x && x.trim()).join(" ").trim();
  const adresse = [rue, ville, p.pays].filter((x) => x && x.trim()).join(", ").trim();
  return { nom, email, telephone: (p.telephone ?? "").trim(), adresse };
}

/* ------------------------------------------------------------------ modèle par défaut */

export const PRETEUR_DEFAUT = `TRADE EUROPE INVESTMENT
31, AVENUE PRINCESSE GRACE L'ESTORIL BLOC B - 16EME ETAGE - N°03 PRINCIPAUTE DE MONACO
Tel : +33 644677689
Email : trade-europemonaco@proton.me - contact@alpinum-bank.fr
Représenté par Monsieur MANGO ALESSANDRO, Head Manager Trade and Investment World Wide
Conseil des Investisseurs Représenté par PhD, SERGE BEITZ, Banquier et Analyste Financier - Credit Manager`;

export const CORPS_CONTRAT_DEFAUT = `RECITALS
WHEREAS the Borrower has requested from the Lender a loan for general corporate purposes and/or for its working capital needs;
WHEREAS the Lender has agreed to make available to the Borrower a loan of the principal amount set out below, on the terms and conditions set forth in this Agreement;
NOW THEREFORE, in consideration of the mutual covenants and agreements set forth herein, the Parties agree as follows:

ARTICLE 1: DEFINITIONS AND INTERPRETATION
1.1 Definitions
In this Agreement, unless the context otherwise requires, the following terms shall have the meanings ascribed to them below:
"Agreement" : means this Universal Professional/Individual Loan Agreement, including its schedules and amendments.
"Business Day" : means any day (other than a Saturday or a Sunday) on which commercial banks are open to the public for general business in the jurisdictions of the Lender, the Borrower, and the place of payment.
"Default" : means any event or circumstance referred to in Article 9.
"Disbursement Date" : means the date on which the Lender transfers the Loan Amount to the Borrower's Designated Account.
"Designated Account" : means the bank account designated in writing by the Borrower to the Lender for the purpose of receiving the proceeds of the Loan.
"Event of Default" : has the meaning ascribed to it in Article 9.
"Interest Payment Date(s)" : means the date(s) provided for in Article 4 for the payment of interest.
"Loan" : means the total principal amount disbursed and outstanding under this Agreement at any given time.
"Loan Amount" : means the principal sum disbursed and outstanding under this Agreement, as set out in Article 2.1 and in the Annex.
"Maturity Date" : means the date on which the Loan becomes due and payable in full, as set out in the Annex.
"Outstanding Amount" : means, at any time, the total principal amount of the Loan, increased by all accrued and unpaid interest, fees, and other sums due under this Agreement.
"Repayment Date" : has the meaning ascribed to it in Article 5.
"Security / Guarantee" : means any mortgage, charge, pledge, lien, surety, or other form of real or personal security provided by the Borrower to the Lender to secure the obligations arising under this Agreement.
1.2 Interpretation
Headings and titles are inserted for convenience only and shall not affect the interpretation of this Agreement.
Any reference to a "person" includes any natural person, corporation, company, association, partnership, joint-venture, trust, or public body.
Any reference to "including" or "includes" shall be construed as non-limiting.

ARTICLE 2: THE LOAN
2.1 Amount and Purpose of the Loan
The Lender grants to the Borrower, and the Borrower accepts, a loan in the amount of {{LOAN_AMOUNT_WORDS}} euros ({{LOAN_AMOUNT}} EUR). The Borrower shall use the Loan exclusively for the following purpose: {{PURPOSE}}, unless otherwise agreed in writing by the Lender. The Loan may not be used in violation of any applicable law, including anti-money laundering (AML) and counter-terrorism financing (CTF) regulations.
2.2 Conditions Precedent
The Lender shall not be obliged to disburse the Loan until the following conditions have been satisfied (or waived in writing by the Lender):
1. The Lender has received duly executed copies of this Agreement.
2. The Lender has received copies of all corporate authorizations (e.g., board resolutions) empowering the Borrower to enter into this Agreement and to borrow the Loan.
3. The Lender has received all documents required under the "Know Your Customer" (KYC) procedure.
4. The Lender has received the documentation relating to the Security/Guarantee (if applicable), in form and substance satisfactory to it. In the absence of a security or guarantee, the Lender has received proof of subscription to a credit insurance policy, either procured by the Borrower itself or provided on its behalf through our group insurance program.
5. The Lender has received an authorization from the Investors' Council confirming the validity and enforceability of this Agreement and the Security.
2.3 Disbursement
Subject to the satisfaction of the conditions precedent, the Lender shall disburse the Loan Amount to the Borrower's Designated Account on or before the Disbursement Date.

ARTICLE 3: REPRESENTATIONS AND WARRANTIES
The Borrower represents and warrants to the Lender as follows:
3.1 Legal Status
The Borrower is duly incorporated, validly existing, and in good standing under the laws of its jurisdiction of incorporation.
3.2 Authority and Enforceability
The Borrower has all necessary powers and authorizations to sign, deliver, and perform its obligations under this Agreement. This Agreement constitutes its legal, valid, and binding obligation, enforceable against it in accordance with its terms.
3.3 No Conflict
The execution and performance of this Agreement do not violate any law, regulation, or agreement applicable to the Borrower.
3.4 Litigation
No material judicial, arbitral, or administrative proceedings are pending or threatened against the Borrower that could materially and adversely affect its financial condition or its ability to perform its obligations under this Agreement.
3.5 Financial Condition
All financial statements and information provided by the Borrower to the Lender are true, accurate, and fairly reflect its financial condition as of the date thereof.

ARTICLE 4: INTEREST
4.1 Interest Rate
The Outstanding Amount shall bear interest at a fixed annual rate of {{INTEREST_RATE}}% per annum. Interest shall be calculated on the basis of a 360-day year and the actual number of days elapsed.
4.2 Payment of Interest
Interest shall accrue from the Disbursement Date and shall be payable on each Interest Payment Date, as follows:
Frequency: Monthly
First Interest Payment Date: Disbursement Date + 03 months (grace period)
Last Interest Payment Date: The Maturity Date.
4.3 Default Interest
If the Borrower fails to pay any amount due under this Agreement on its due date, a default interest rate shall apply, equal to the applicable interest rate plus 0.05%, until full payment of the amount due.

ARTICLE 5: REPAYMENT
5.1 Repayment Schedule
The Borrower shall repay the Loan and all accrued interest as follows:
[Option A: Bullet Repayment] : The Outstanding Amount shall be repaid in full on the Maturity Date. ( )
[Option B: Installment Repayment] : The Borrower shall repay the Loan in {{INSTALLMENTS}} constant successive installments. The first installment shall be payable on: Disbursement Date + 03 months (grace period), and the subsequent installments shall be monthly or quarterly until the Maturity Date. (X)
5.2 Early Repayment
The Borrower may prepay all or part of the Loan before the Maturity Date, subject to:
Giving the Lender at least 30 days' prior written notice.
Payment of all accrued and unpaid interest up to the date of prepayment.
[Optional: Prepayment Penalty] : Payment of a prepayment penalty equal to 0% of the amount prepaid.

ARTICLE 6: OBLIGATIONS / COVENANTS
6.1 Affirmative Covenants
The Borrower undertakes to:
Provide the Lender, within 60 days after the close of its fiscal year, with its audited annual financial statements or any other related documents, including proof of settlement of its tax and professional obligations.
Notify the Lender without delay of an Event of Default or any event likely to materially affect its ability to repay the Loan.
Maintain its legal existence and comply with all applicable laws and regulations.
6.2 Negative Covenants
Without the prior written consent of the Lender, the Borrower shall not:
Incur additional indebtedness that could compromise its ability to repay the Loan.
Create any security or encumbrance over its assets (other than in favor of the Lender).
Change the nature of its business.

ARTICLE 7: SECURITY / GUARANTEE
[Option A: Secured Loan] ( )
As security for the payment of all amounts due under this Agreement, the Borrower shall provide the Lender with a security over its assets, in form and substance satisfactory to the Lender. All costs relating to the creation and perfection of the Security shall be borne by the Borrower.
[Option B: Unsecured Loan] (X)
This Loan is granted without any real security. The Lender relies solely on the creditworthiness of the Borrower and on the representations and warranties set forth in this Agreement, plus the mandatory subscription to a credit insurance policy.

ARTICLE 8: INDEMNIFICATION AND EXPENSES
8.1 Indemnification
The Borrower agrees to indemnify and hold harmless the Lender against all losses, claims, damages, and expenses (including reasonable legal fees) arising out of or in connection with:
Any breach by the Borrower of its obligations under this Agreement.
Any inaccurate representation by the Borrower.
The exercise by the Lender of any rights conferred upon this Agreement.
8.2 Expenses
The Borrower shall bear all costs and expenses incurred by the Lender in connection with the preparation, negotiation, execution, and enforcement of this Agreement and any Security document.

ARTICLE 9: EVENTS OF DEFAULT AND REMEDIES
9.1 Events of Default
Each of the following events shall constitute an Event of Default:
Payment Default: Failure by the Borrower to pay any amount (principal, interest, or otherwise) due under this Agreement within 05 days after its due date.
Breach of Obligation: Failure to perform any of the obligations set forth in this Agreement (other than payment), if such failure is not remedied within 30 days after written notice from the Lender.
Inaccurate Representation: Any representation or warranty made by the Borrower is false or misleading in any material respect.
Insolvency: The Borrower becomes insolvent, is unable to pay its debts as they fall due, or makes an assignment for the benefit of its creditors. The Borrower files a voluntary bankruptcy petition, or an involuntary petition is filed against the Borrower and is not dismissed within 30 days.
9.2 Remedies
Upon the occurrence of an Event of Default, the Lender may, by written notice to the Borrower, declare all or part of the Outstanding Amount immediately due and payable. The Lender may also exercise any other rights or remedies available to it under applicable law or under any Security document.

ARTICLE 10: GOVERNING LAW AND DISPUTE RESOLUTION
10.1 Governing Law
This Agreement shall be governed by and construed in accordance with the laws of the Principality of MONACO.
10.2 Dispute Resolution
Any dispute, controversy, claim, or disagreement arising out of or in connection with this Agreement (including its existence, validity, performance, breach, or termination) shall be finally settled by arbitration.
Arbitration Institution: the members of this institution shall be defined by both Parties to the Agreement.
Rules: The arbitration shall be conducted in accordance with the rules of the chosen institution in effect at the time of the dispute.
Seat of Arbitration: MONACO or LIECHTENSTEIN.
Language: The language of the arbitration shall be French or English.
Enforcement: The award rendered by the arbitral tribunal shall be final and binding on the Parties. However, if either Party is dissatisfied, it may request a regular proceeding before a competent court. The award may be enforced in any competent jurisdiction. This choice of arbitration facilitates the execution of the Agreement.

ARTICLE 11: NOTIFICATIONS
Any notice or other communication under this Agreement shall be in writing and shall be deemed duly delivered if delivered in person, sent by registered mail, or by email to the addresses set forth below:
To the Lender: 31, AVENUE PRINCESSE GRACE L'ESTORIL BLOC B - 16EME ETAGE - N°03 PRINCIPAUTE DE MONACO
To the Borrower: the address set out in the Parties & Contacts table above.
Sending the Agreement via email is also valid, and this shall remain effective for at least 6 months.

ARTICLE 12: GENERAL PROVISIONS
12.1 Assignment
Neither Party may assign or transfer all or part of its rights or obligations under this Agreement without the prior written consent of the other Party.
12.2 Amendments
No amendment to this Agreement shall be valid unless made in writing and signed by both Parties.
12.3 Severability
If any provision of this Agreement is held to be invalid or unenforceable, the remaining provisions shall remain in full force and effect.
12.4 Entire Agreement
This Agreement constitutes the entire agreement between the Parties and supersedes all prior negotiations, representations, or agreements, whether written or oral.
12.5 Multiple Counterparts
This Agreement may be signed in several counterparts, each of which shall be deemed an original and all of which together shall constitute one and the same instrument.

IN WITNESS WHEREOF, the Parties have signed this Agreement on the date first written above.`;

/* ------------------------------------------------------------------ placeholders & découpage */

/** Valeurs automatiques des placeholders, dérivées du contrat (source de vérité : le magasin). */
export function varsContrat(c: { montant: number; objet: string; tauxAnnuel: number; dureeMois: number; reference?: string }): Record<string, string> {
  return {
    LOAN_AMOUNT_WORDS: capitaliser(montantEnLettresEn(c.montant)),
    LOAN_AMOUNT: new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(c.montant),
    PURPOSE: c.objet,
    INTEREST_RATE: String(Math.round(c.tauxAnnuel * 100) / 100),
    INSTALLMENTS: String(c.dureeMois),
    REFERENCE: c.reference ?? "",
  };
}

function capitaliser(s: string): string { return s.length ? s[0].toUpperCase() + s.slice(1) : s; }

/** Remplace chaque `{{CLE}}` par sa valeur ; laisse les clés inconnues telles quelles. */
export function substituerPlaceholders(corps: string, vars: Record<string, string>): string {
  return corps.replace(/\{\{([A-Z_]+)\}\}/g, (m, cle: string) => (cle in vars ? vars[cle] : m));
}

/** Découpe le corps en blocs : lignes `ARTICLE n…` = titres, le reste = paragraphes. */
export function decouperCorps(corps: string): BlocCorps[] {
  return corps
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l): BlocCorps => (/^ARTICLE\s+\d+/i.test(l) || /^RECITALS$/i.test(l) ? { type: "titre", texte: l } : { type: "paragraphe", texte: l }));
}

/* ------------------------------------------------------------------ échappement & HTML autonome */

export function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface ArgsDocumentContrat {
  contrat: { id: string; reference?: string; montant: number; dureeMois: number; tauxAnnuel: number; mensualite: number; objet: string; creeA: string; majA: string };
  emprunteur: Emprunteur;
  preteur: string;
  corps: string;
  /** dataURL embarqué OU chemin d'asset (`/logos/tei.png`) ; null = entête texte de repli. */
  logoSrc: string | null;
  mentions: string[];
}

/** Document HTML AUTONOME (téléchargeable) : entête logo, parties, corps, signatures, ANNEXE crédit. */
export function rendreHtmlContrat(a: ArgsDocumentContrat): string {
  const vars = varsContrat(a.contrat);
  const corps = substituerPlaceholders(a.corps, vars);
  const blocs = decouperCorps(corps);
  const lignes = lignesEcheancierContrat(a.contrat.montant, a.contrat.dureeMois, a.contrat.tauxAnnuel, a.contrat.creeA);
  const total = Math.round(a.contrat.mensualite * a.contrat.dureeMois * 100) / 100;
  const interets = Math.round((total - a.contrat.montant) * 100) / 100;
  const fmt = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  const em = a.emprunteur;

  const lignesCorps = blocs
    .map((b) => (b.type === "titre" ? `<h2>${escHtml(b.texte)}</h2>` : `<p>${escHtml(b.texte)}</p>`))
    .join("\n");

  const lignesAnnexe = lignes
    .map((l) => `<tr><td>${l.mois}</td><td>${escHtml(dateContratEn(l.date))}</td><td>${fmt(l.mensualite)}</td><td>${fmt(l.capitalRestant)}</td></tr>`)
    .join("\n");

  const mentions = a.mentions.length
    ? `<h2>Special Conditions / Mentions</h2>${a.mentions.map((m) => `<p>— ${escHtml(m)}</p>`).join("\n")}`
    : "";

  const logo = a.logoSrc
    ? `<img src="${a.logoSrc}" alt="logo" style="max-height:84px;max-width:420px" />`
    : `<h1 style="color:#1B2A6B;font-size:26px;margin:0">TRADE EUROPE INVESTMENT</h1><div style="color:#B08A3E;letter-spacing:.35em;font-size:11px">LOAN AND BUSINESS</div>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${escHtml(a.contrat.reference || a.contrat.id)} — Loan Agreement</title>
<style>
body{font-family:Georgia,'Times New Roman',serif;max-width:820px;margin:36px auto;color:#14161f;line-height:1.55;padding:0 24px;font-size:13.5px}
header{border-bottom:3px solid #1B2A6B;padding-bottom:14px;margin-bottom:22px}
h1{font-size:21px;letter-spacing:.05em;color:#1B2A6B;margin:18px 0 4px}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.1em;margin:22px 0 8px;color:#1B2A6B}
p{margin:6px 0}
table{border-collapse:collapse;width:100%;margin:10px 0}
td,th{border:1px solid #9aa0b0;padding:7px 9px;vertical-align:top;text-align:left;font-size:12.5px}
th{background:#f2f4f9;text-transform:uppercase;font-size:10.5px;letter-spacing:.08em}
.ref{font-size:12.5px;margin:2px 0}
.sign{display:flex;gap:40px;margin:26px 0}
.sign div{flex:1;border-top:1px solid #14161f;padding-top:6px;font-size:12px}
footer{margin-top:30px;border-top:1px solid #9aa0b0;padding-top:8px;font-size:11px;color:#5a5f6e}
</style></head><body>
<header>${logo}
<h1>LOAN AGREEMENT</h1>
<p class="ref">Reference Number: ${escHtml(a.contrat.reference || a.contrat.id)}</p>
<p class="ref">Date: ${escHtml(dateContratEn(a.contrat.majA))}</p>
</header>
<p>THIS LOAN AGREEMENT (hereinafter referred to as the "Agreement") is entered into on the date mentioned above between:</p>
<h2>Parties &amp; Contacts</h2>
<table><tr><th>Role</th><th>Name</th></tr>
<tr><td>THE LENDER</td><td>${escHtml(a.preteur).replace(/\n/g, "<br>")}</td></tr>
<tr><td>THE BORROWER</td><td>${escHtml(em.nom)}<br>${escHtml(em.email)}${em.telephone ? `<br>${escHtml(em.telephone)}` : ""}${em.adresse ? `<br>${escHtml(em.adresse)}` : ""}</td></tr>
</table>
<p>(The Lender and the Borrower are hereinafter collectively referred to as the "Parties" and individually as a "Party").</p>
${lignesCorps}
<h2>Signatures</h2>
<div class="sign"><div>THE LENDER<br>Trade Europe Investment</div><div>THE BORROWER<br>${escHtml(em.nom)}</div></div>
${mentions}
<h2>Annexe — Credit Data</h2>
<table>
<tr><th>Item</th><th>Value</th></tr>
<tr><td>Loan Amount</td><td>${fmt(a.contrat.montant)} EUR (${escHtml(vars.LOAN_AMOUNT_WORDS)} euros)</td></tr>
<tr><td>Purpose</td><td>${escHtml(a.contrat.objet)}</td></tr>
<tr><td>Annual Interest Rate</td><td>${escHtml(vars.INTEREST_RATE)} %</td></tr>
<tr><td>Term</td><td>${a.contrat.dureeMois} monthly installments</td></tr>
<tr><td>Monthly Installment</td><td>${fmt(a.contrat.mensualite)} EUR</td></tr>
<tr><td>Total Repayment</td><td>${fmt(total)} EUR</td></tr>
<tr><td>Total Interest</td><td>${fmt(interets)} EUR</td></tr>
<tr><td>Disbursement Date</td><td>${escHtml(dateContratEn(a.contrat.creeA))}</td></tr>
<tr><td>First Installment</td><td>${lignes.length ? escHtml(dateContratEn(lignes[0].date)) : "—"}</td></tr>
<tr><td>Maturity Date</td><td>${lignes.length ? escHtml(dateContratEn(lignes[lignes.length - 1].date)) : "—"}</td></tr>
</table>
<h2>Annexe — Repayment Schedule</h2>
<table><tr><th>#</th><th>Payment Date</th><th>Installment (EUR)</th><th>Outstanding Principal (EUR)</th></tr>
${lignesAnnexe}
</table>
<footer>Reference ${escHtml(a.contrat.reference || a.contrat.id)} — ${escHtml(dateContratEn(a.contrat.majA))}</footer>
</body></html>`;
}
