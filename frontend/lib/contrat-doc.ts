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

/** Le document de prêt existe en DEUX langues éditables : anglais (fourni) et français. */
export type LangueContrat = "EN" | "FR";
export function langueContratValide(x: unknown): x is LangueContrat { return x === "EN" || x === "FR"; }

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

/* ------------------------------------------------------------------ nombres en lettres (FR) */

const UNITES_FR = ["zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix",
  "onze", "douze", "treize", "quatorze", "quinze", "seize", "dix-sept", "dix-huit", "dix-neuf"];
const DIZAINES_FR = ["", "", "vingt", "trente", "quarante", "cinquante", "soixante", "", "quatre-vingt"];

function deuxChiffresFr(n: number): string {
  if (n < 20) return UNITES_FR[n];
  const d = Math.floor(n / 10);
  const u = n % 10;
  if (d === 7 || d === 9) {
    const base = d === 7 ? "soixante" : "quatre-vingt";
    const reste = n - (d === 7 ? 60 : 80);
    if (d === 7 && reste === 11) return "soixante et onze";
    return `${base}-${UNITES_FR[reste]}`;
  }
  if (d === 8) return u ? `quatre-vingt-${UNITES_FR[u]}` : "quatre-vingts";
  if (u === 1) return `${DIZAINES_FR[d]} et un`;
  if (u === 0) return DIZAINES_FR[d];
  return `${DIZAINES_FR[d]}-${UNITES_FR[u]}`;
}

function troisChiffresFr(n: number): string {
  const c = Math.floor(n / 100);
  const r = n % 100;
  const mots: string[] = [];
  if (c) mots.push(c === 1 ? "cent" : `${UNITES_FR[c]} cent${r === 0 ? "s" : ""}`);
  if (r) mots.push(deuxChiffresFr(r));
  return mots.join(" ");
}

/** Montant entier en lettres françaises (« sept cent cinquante-cinq mille »). Borné à 10^15−1. */
export function montantEnLettresFr(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "zéro";
  const entier = Math.floor(n);
  if (entier === 0) return "zéro";
  if (entier >= 1e15) return String(entier);
  const groupes: number[] = [];
  let reste = entier;
  while (reste > 0) { groupes.push(reste % 1000); reste = Math.floor(reste / 1000); }
  const mots: string[] = [];
  for (let i = groupes.length - 1; i >= 0; i--) {
    const g = groupes[i];
    if (!g) continue;
    if (i === 0) mots.push(troisChiffresFr(g));
    else if (i === 1) mots.push(`${g === 1 ? "" : `${troisChiffresFr(g)} `}mille`);
    else mots.push(`${troisChiffresFr(g)} ${i === 2 ? "million" : "milliard"}${g > 1 ? "s" : ""}`);
  }
  return mots.join(" ");
}

/** Date du contrat au format français : « 3 septembre 2026 » (« 1er » pour le 1). */
export function dateContratFr(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const mois = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  const j = d.getUTCDate();
  return `${j === 1 ? "1er" : j} ${mois[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
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

/** Version FRANÇAISE du modèle — mêmes placeholders, même structure (traduction fidèle). */
export const CORPS_CONTRAT_FR = `EXPOSÉ PRÉALABLE
CONSIDÉRANT que l'Emprunteur a demandé au Prêteur un prêt pour les besoins généraux de son activité et/ou pour ses besoins en fonds de roulement ;
CONSIDÉRANT que le Prêteur a accepté de mettre à disposition de l'Emprunteur un prêt du montant en capital défini ci-dessous, selon les termes et conditions du présent Contrat ;
EN CONSÉQUENCE, en contrepartie des engagements mutuels ci-après, les Parties conviennent de ce qui suit :

ARTICLE 1 : DÉFINITIONS ET INTERPRÉTATION
1.1 Définitions
Dans le présent Contrat, sauf si le contexte exige une autre interprétation, les termes suivants ont le sens qui leur est attribué ci-dessous :
« Contrat » : désigne le présent Contrat de prêt universel professionnel/particulier, y compris ses annexes et avenants.
« Jour ouvré » : désigne tout jour (autre qu'un samedi ou un dimanche) où les banques commerciales sont ouvertes au public pour leurs opérations courantes dans les juridictions du Prêteur, de l'Emprunteur et du lieu de paiement.
« Défaut » : désigne tout événement ou toute circonstance visé à l'article 9.
« Date de Déblocage » : désigne la date à laquelle le Prêteur transfère le Montant du Prêt sur le Compte Désigné de l'Emprunteur.
« Compte Désigné » : désigne le compte bancaire désigné par écrit par l'Emprunteur auprès du Prêteur afin de recevoir le produit du Prêt.
« Cas de Défaut » : a le sens qui lui est attribué à l'article 9.
« Date(s) de Paiement des Intérêts » : désigne la ou les dates prévues à l'article 4 pour le paiement des intérêts.
« Prêt » : désigne le montant total en capital déblocé et exigible au titre du présent Contrat à un moment donné.
« Montant du Prêt » : désigne la somme en capital déblocée et exigible au titre du présent Contrat, telle que définie à l'article 2.1 et en Annexe.
« Date d'Échéance » : désigne la date à laquelle le Prêt devient exigible en totalité, telle que définie en Annexe.
« Montant Exigible » : désigne, à tout moment, le montant total en capital du Prêt, majoré de tous les intérêts courus et impayés, frais et autres sommes dus au titre du présent Contrat.
« Date de Remboursement » : a le sens qui lui est attribué à l'article 5.
« Sûreté / Garantie » : désigne toute hypothèque, nantissement, gage, privilège, cautionnement ou toute autre forme de sûreté réelle ou personnelle fournie par l'Emprunteur au Prêteur pour garantir les obligations nées du présent Contrat.
1.2 Interprétation
Les titres et intertitres sont insérés pour la seule commodité et n'affectent pas l'interprétation du présent Contrat.
Toute référence à une « personne » inclut toute personne physique, société, entreprise, association, société de personnes, coentreprise, fiducie ou organisme public.
Toute référence à « y compris » ou « inclut » doit être comprise comme non limitative.

ARTICLE 2 : LE PRÊT
2.1 Montant et Objet du Prêt
Le Prêteur accorde à l'Emprunteur, qui l'accepte, un prêt d'un montant de {{LOAN_AMOUNT_WORDS}} euros ({{LOAN_AMOUNT}} EUR). L'Emprunteur utilisera le Prêt exclusivement aux fins suivantes : {{PURPOSE}}, sauf accord écrit contraire du Prêteur. Le Prêt ne pourra être utilisé en violation de toute loi applicable, y compris les réglementations relatives à la lutte contre le blanchiment d'argent (AML) et au financement du terrorisme (CTF).
2.2 Conditions Préalables
Le Prêteur ne sera tenu de débloquer le Prêt qu'une fois les conditions suivantes satisfaites (ou auxquelles il aura renoncé par écrit) :
1. Le Prêteur a reçu des copies dûment signées du présent Contrat.
2. Le Prêteur a reçu des copies de toutes les autorisations sociales (ex. résolutions du conseil) habilitant l'Emprunteur à conclure le présent Contrat et à contracter le Prêt.
3. Le Prêteur a reçu tous les documents requis au titre de la procédure « Know Your Customer » (KYC).
4. Le Prêteur a reçu la documentation relative à la Sûreté/Garantie (le cas échéant), en la forme et au fond jugées satisfaisantes par lui. À défaut de sûreté ou de garantie, le Prêteur a reçu la preuve de la souscription d'une police d'assurance-crédit, soit par l'Emprunteur lui-même, soit pour son compte par le biais de notre programme d'assurance groupe.
5. Le Prêteur a reçu une autorisation du Conseil des Investisseurs confirmant la validité et le caractère exécutoire du présent Contrat et de la Sûreté.
2.3 Déblocage
Sous réserve de la satisfaction des conditions préalables, le Prêteur transférera le Montant du Prêt sur le Compte Désigné de l'Emprunteur au plus tard à la Date de Déblocage.

ARTICLE 3 : DÉCLARATIONS ET GARANTIES
L'Emprunteur déclare et garantit au Prêteur ce qui suit :
3.1 Statut Juridique
L'Emprunteur est dûment constitué, valablement existant et en règle au regard des lois de sa juridiction de constitution.
3.2 Pouvoirs et Caractère Exécutoire
L'Emprunteur dispose de tous les pouvoirs et autorisations nécessaires pour signer, remettre et exécuter ses obligations au titre du présent Contrat. Le présent Contrat constitue son obligation légale, valide et contraignante, exécutoire à son encontre conformément à ses termes.
3.3 Absence de Conflit
La signature et l'exécution du présent Contrat ne violent aucune loi, réglementation ou convention applicable à l'Emprunteur.
3.4 Litiges
Aucune procédure judiciaire, arbitrale ou administrative importante n'est en cours ou menacée à l'encontre de l'Emprunteur qui pourrait affecter de manière significative sa situation financière ou sa capacité à exécuter ses obligations au titre du présent Contrat.
3.5 Situation Financière
Tous les états financiers et informations fournis par l'Emprunteur au Prêteur sont sincères, exacts et reflètent fidèlement sa situation financière à leur date.

ARTICLE 4 : INTÉRÊTS
4.1 Taux d'Intérêt
Le Montant Exigible porte intérêt au taux fixe de {{INTEREST_RATE}} % par an. Les intérêts sont calculés sur la base d'une année de 360 jours et du nombre de jours effectivement écoulés.
4.2 Paiement des Intérêts
Les intérêts courent à compter de la Date de Déblocage et sont payables à chaque Date de Paiement des Intérêts, comme suit :
Fréquence : Mensuelle
Première Date de Paiement des Intérêts : Date de Déblocage + 03 mois (période de grâce)
Dernière Date de Paiement des Intérêts : la Date d'Échéance.
4.3 Intérêts de Retard
Si l'Emprunteur ne paie pas une somme due au titre du présent Contrat à son échéance, un taux d'intérêt de retard s'applique, égal au taux applicable majoré de 0,05 %, jusqu'au paiement intégral de la somme due.

ARTICLE 5 : REMBOURSEMENT
5.1 Calendrier de Remboursement
L'Emprunteur remboursera le Prêt et tous les intérêts courus comme suit :
[Option A : Remboursement in fine] : le Montant Exigible est remboursé en totalité à la Date d'Échéance. ( )
[Option B : Remboursement échelonné] : l'Emprunteur remboursera le Prêt en {{INSTALLMENTS}} échéances constantes et successives. La première échéance sera payable à : Date de Déblocage + 03 mois (période de grâce), et les échéances suivantes seront mensuelles ou trimestrielles jusqu'à la Date d'Échéance. (X)
5.2 Remboursement Anticipé
L'Emprunteur peut rembourser tout ou partie du Prêt avant la Date d'Échéance, sous réserve de :
Donner au Prêteur un préavis écrit d'au moins 30 jours.
Payer tous les intérêts courus et impayés jusqu'à la date du remboursement anticipé.
[Facultatif : Indemnité de remboursement anticipé] : paiement d'une indemnité égale à 0 % du montant remboursé par anticipation.

ARTICLE 6 : OBLIGATIONS / ENGAGEMENTS
6.1 Engagements Positifs
L'Emprunteur s'engage à :
Fournir au Prêteur, dans les 60 jours suivant la clôture de son exercice, ses états financiers annuels audités ou tout autre document lié, y compris la preuve du règlement de ses obligations fiscales et professionnelles.
Notifier sans délai au Prêteur tout Cas de Défaut ou tout événement susceptible d'affecter significativement sa capacité à rembourser le Prêt.
Maintenir son existence légale et se conformer à toutes les lois et réglementations applicables.
6.2 Engagements Négatifs
Sans le consentement écrit préalable du Prêteur, l'Emprunteur ne pourra :
Contracter des dettes supplémentaires susceptibles de compromettre sa capacité à rembourser le Prêt.
Constituer une sûreté ou une charge sur ses actifs (autre qu'au profit du Prêteur).
Changer la nature de son activité.

ARTICLE 7 : SÛRETÉ / GARANTIE
[Option A : Prêt garanti] ( )
En garantie du paiement de toutes les sommes dues au titre du présent Contrat, l'Emprunteur fournira au Prêteur une sûreté sur ses actifs, en la forme et au fond jugées satisfaisantes par le Prêteur. Tous les coûts liés à la constitution et à la perfection de la Sûreté sont à la charge de l'Emprunteur.
[Option B : Prêt non garanti] (X)
Le présent Prêt est accordé sans sûreté réelle. Le Prêteur se fonde uniquement sur la solvabilité de l'Emprunteur et sur les déclarations et garanties du présent Contrat, ainsi que sur la souscription obligatoire d'une police d'assurance-crédit.

ARTICLE 8 : INDEMNISATION ET FRAIS
8.1 Indemnisation
L'Emprunteur s'engage à indemniser le Prêteur et à le garantir de toutes pertes, réclamations, dommages et frais (y compris les honoraires d'avocat raisonnables) résultant de ou liés à :
Toute violation par l'Emprunteur de ses obligations au titre du présent Contrat.
Toute déclaration inexacte de l'Emprunteur.
L'exercice par le Prêteur de ses droits au titre du présent Contrat.
8.2 Frais
L'Emprunteur supporte tous les coûts et frais engagés par le Prêteur au titre de la préparation, de la négociation, de la signature et de l'exécution du présent Contrat et de tout document de Sûreté.

ARTICLE 9 : CAS DE DÉFAUT ET RECOURS
9.1 Cas de Défaut
Chacun des événements suivants constitue un Cas de Défaut :
Défaut de Paiement : non-paiement par l'Emprunteur d'une somme (capital, intérêts ou autre) due au titre du présent Contrat dans les 05 jours suivant son échéance.
Violation d'Obligation : manquement à l'une des obligations du présent Contrat (autre que le paiement), s'il n'est pas réparé dans les 30 jours suivant une notification écrite du Prêteur.
Déclaration Inexacte : toute déclaration ou garantie faite par l'Emprunteur est fausse ou trompeuse sur un point important.
Insolvabilité : l'Emprunteur devient insolvable, est incapable de payer ses dettes à leur échéance, ou fait cession de ses biens au profit de ses créanciers. L'Emprunteur dépose une demande de faillite volontaire, ou une demande involontaire est déposée contre lui et n'est pas rejetée dans les 30 jours.
9.2 Recours
À la survenance d'un Cas de Défaut, le Prêteur peut, par notification écrite à l'Emprunteur, déclarer tout ou partie du Montant Exigible immédiatement exigible. Le Prêteur peut également exercer tout autre droit ou recours prévu par la loi applicable ou par tout document de Sûreté.

ARTICLE 10 : LOI APPLICABLE ET RÈGLEMENT DES LITIGES
10.1 Loi Applicable
Le présent Contrat est régi et interprété conformément aux lois de la Principauté de MONACO.
10.2 Règlement des Litiges
Tout différend, contestation, réclamation ou désaccord né du présent Contrat ou en lien avec celui-ci (y compris son existence, sa validité, son exécution, sa violation ou sa résiliation) sera définitivement tranché par arbitrage.
Institution d'Arbitrage : les membres de cette institution seront définis par les deux Parties au Contrat.
Règles : l'arbitrage se déroule conformément aux règles de l'institution choisie en vigueur au moment du litige.
Siège de l'Arbitrage : MONACO ou LIECHTENSTEIN.
Langue : la langue de l'arbitrage sera le français ou l'anglais.
Exécution : la sentence rendue par le tribunal arbitral est définitive et lie les Parties. Toutefois, si une Partie n'est pas satisfaite, elle peut demander une procédure ordinaire devant une juridiction compétente. La sentence peut être exécutée dans toute juridiction compétente. Ce choix de l'arbitrage facilite l'exécution du Contrat.

ARTICLE 11 : NOTIFICATIONS
Toute notification ou communication au titre du présent Contrat est faite par écrit et est réputée dûment remise si elle est remise en main propre, envoyée par lettre recommandée ou par e-mail aux adresses ci-dessous :
Au Prêteur : 31, AVENUE PRINCESSE GRACE L'ESTORIL BLOC B - 16EME ETAGE - N°03 PRINCIPAUTE DE MONACO
À l'Emprunteur : l'adresse indiquée dans le tableau Parties & Contacts ci-dessus.
L'envoi du Contrat par e-mail est également valable et reste effectif pendant au moins 6 mois.

ARTICLE 12 : DISPOSITIONS GÉNÉRALES
12.1 Cession
Aucune Partie ne peut céder ou transférer tout ou partie de ses droits ou obligations au titre du présent Contrat sans le consentement écrit préalable de l'autre Partie.
12.2 Avenants
Aucun avenant au présent Contrat n'est valable s'il n'est fait par écrit et signé par les deux Parties.
12.3 Divisibilité
Si une stipulation du présent Contrat est tenue pour invalide ou inapplicable, les autres stipulations restent pleinement en vigueur.
12.4 Intégralité
Le présent Contrat constitue l'intégralité de l'accord entre les Parties et remplace toutes les négociations, déclarations et accords antérieurs, écrits ou oraux.
12.5 Pluralité d'Exemplaires
Le présent Contrat peut être signé en plusieurs exemplaires, chacun étant réputé un original, l'ensemble constituant un seul et même acte.

EN FOI DE QUOI, les Parties ont signé le présent Contrat à la date mentionnée en tête des présentes.`;

export function corpsDefautDe(langue: LangueContrat): string {
  return langue === "FR" ? CORPS_CONTRAT_FR : CORPS_CONTRAT_DEFAUT;
}

/* ------------------------------------------------------------------ placeholders & découpage */

/** Valeurs automatiques des placeholders, dérivées du contrat (source de vérité : le magasin). */
export function varsContrat(c: { montant: number; objet: string; tauxAnnuel: number; dureeMois: number; reference?: string }, langue: LangueContrat = "EN"): Record<string, string> {
  return {
    LOAN_AMOUNT_WORDS: langue === "FR" ? capitaliser(montantEnLettresFr(c.montant)) : capitaliser(montantEnLettresEn(c.montant)),
    LOAN_AMOUNT: new Intl.NumberFormat(langue === "FR" ? "fr-BE" : "en-US", { maximumFractionDigits: 2 }).format(c.montant),
    PURPOSE: c.objet,
    INTEREST_RATE: String(Math.round(c.tauxAnnuel * 100) / 100).replace(".", langue === "FR" ? "," : "."),
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
    .map((l): BlocCorps => (/^ARTICLE\s+\d+/i.test(l) || /^RECITALS$/i.test(l) || /^EXPOSÉ PRÉALABLE$/i.test(l) ? { type: "titre", texte: l } : { type: "paragraphe", texte: l }));
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
  /** Langue du document : EN (modèle fourni) ou FR — deux langues, pas davantage. */
  langue?: LangueContrat;
}

/** Libellés du document (hors corps éditable) par langue — le corps vient du modèle choisi. */
const LIBELLES_DOC: Record<LangueContrat, Record<string, string>> = {
  EN: {
    titre: "LOAN AGREEMENT", ref: "Reference Number", sep: ":", date: "Date",
    intro: "THIS LOAN AGREEMENT (hereinafter referred to as the \"Agreement\") is entered into on the date mentioned above between:",
    parties: "Parties & Contacts", role: "Role", name: "Name", lender: "THE LENDER", borrower: "THE BORROWER",
    partiesNote: "(The Lender and the Borrower are hereinafter collectively referred to as the \"Parties\" and individually as a \"Party\").",
    signatures: "Signatures", mentions: "Special Conditions / Mentions",
    annexeData: "Annexe — Credit Data", item: "Item", value: "Value",
    loanAmount: "Loan Amount", purpose: "Purpose", rate: "Annual Interest Rate", termLabel: "Term", term: "monthly installments",
    monthly: "Monthly Installment", total: "Total Repayment", interest: "Total Interest",
    disb: "Disbursement Date", first: "First Installment", maturity: "Maturity Date",
    annexeSchedule: "Annexe — Repayment Schedule",
    thNum: "#", thDate: "Payment Date", thInst: "Installment (EUR)", thOut: "Outstanding Principal (EUR)",
  },
  FR: {
    titre: "CONTRAT DE PRÊT", ref: "Numéro de référence", sep: " :", date: "Date",
    intro: "LE PRÉSENT CONTRAT DE PRÊT (ci-après le « Contrat ») est conclu à la date mentionnée ci-dessus entre :",
    parties: "Parties & Contacts", role: "Rôle", name: "Nom", lender: "LE PRÊTEUR", borrower: "L'EMPRUNTEUR",
    partiesNote: "(Le Prêteur et l'Emprunteur sont ci-après désignés collectivement les « Parties » et individuellement une « Partie »).",
    signatures: "Signatures", mentions: "Conditions Particulières / Mentions",
    annexeData: "Annexe — Données du crédit", item: "Élément", value: "Valeur",
    loanAmount: "Montant du prêt", purpose: "Objet", rate: "Taux d'intérêt annuel", termLabel: "Durée", term: "mensualités",
    monthly: "Mensualité", total: "Total remboursé", interest: "Total des intérêts",
    disb: "Date de déblocage", first: "Première échéance", maturity: "Date d'échéance",
    annexeSchedule: "Annexe — Échéancier de remboursement",
    thNum: "N°", thDate: "Date de règlement", thInst: "Mensualité (EUR)", thOut: "Capital restant dû (EUR)",
  },
};

/** Document HTML AUTONOME (téléchargeable) : entête logo, parties, corps, signatures, ANNEXE crédit. */
export function rendreHtmlContrat(a: ArgsDocumentContrat): string {
  const langue: LangueContrat = a.langue === "FR" ? "FR" : "EN";
  const L = LIBELLES_DOC[langue];
  const dateDoc = langue === "FR" ? dateContratFr : dateContratEn;
  const vars = varsContrat(a.contrat, langue);
  const corps = substituerPlaceholders(a.corps, vars);
  const blocs = decouperCorps(corps);
  const lignes = lignesEcheancierContrat(a.contrat.montant, a.contrat.dureeMois, a.contrat.tauxAnnuel, a.contrat.creeA);
  const total = Math.round(a.contrat.mensualite * a.contrat.dureeMois * 100) / 100;
  const interets = Math.round((total - a.contrat.montant) * 100) / 100;
  const fmt = (n: number) => new Intl.NumberFormat(langue === "FR" ? "fr-BE" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  const em = a.emprunteur;

  const lignesCorps = blocs
    .map((b) => (b.type === "titre" ? `<h2>${escHtml(b.texte)}</h2>` : `<p>${escHtml(b.texte)}</p>`))
    .join("\n");

  const lignesAnnexe = lignes
    .map((l) => `<tr><td>${l.mois}</td><td>${escHtml(dateDoc(l.date))}</td><td>${fmt(l.mensualite)}</td><td>${fmt(l.capitalRestant)}</td></tr>`)
    .join("\n");

  const mentions = a.mentions.length
    ? `<h2>${escHtml(L.mentions)}</h2>${a.mentions.map((m) => `<p>— ${escHtml(m)}</p>`).join("\n")}`
    : "";

  const logo = a.logoSrc
    ? `<img src="${a.logoSrc}" alt="logo" style="max-height:84px;max-width:420px" />`
    : `<h1 style="color:#1B2A6B;font-size:26px;margin:0">TRADE EUROPE INVESTMENT</h1><div style="color:#B08A3E;letter-spacing:.35em;font-size:11px">LOAN AND BUSINESS</div>`;

  return `<!doctype html><html lang="${langue.toLowerCase()}"><head><meta charset="utf-8">
<title>${escHtml(a.contrat.reference || a.contrat.id)} — ${escHtml(L.titre)}</title>
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
<h1>${escHtml(L.titre)}</h1>
<p class="ref">${escHtml(L.ref)}${escHtml(L.sep)} ${escHtml(a.contrat.reference || a.contrat.id)}</p>
<p class="ref">${escHtml(L.date)}${escHtml(L.sep)} ${escHtml(dateDoc(a.contrat.majA))}</p>
</header>
<p>${escHtml(L.intro)}</p>
<h2>${escHtml(L.parties)}</h2>
<table><tr><th>${escHtml(L.role)}</th><th>${escHtml(L.name)}</th></tr>
<tr><td>${escHtml(L.lender)}</td><td>${escHtml(a.preteur).replace(/\n/g, "<br>")}</td></tr>
<tr><td>${escHtml(L.borrower)}</td><td>${escHtml(em.nom)}<br>${escHtml(em.email)}${em.telephone ? `<br>${escHtml(em.telephone)}` : ""}${em.adresse ? `<br>${escHtml(em.adresse)}` : ""}</td></tr>
</table>
<p>${escHtml(L.partiesNote)}</p>
${lignesCorps}
<h2>${escHtml(L.signatures)}</h2>
<div class="sign"><div>${escHtml(L.lender)}<br>${escHtml(a.preteur.split("\n")[0] ?? "")}</div><div>${escHtml(L.borrower)}<br>${escHtml(em.nom)}</div></div>
${mentions}
<h2>${escHtml(L.annexeData)}</h2>
<table>
<tr><th>${escHtml(L.item)}</th><th>${escHtml(L.value)}</th></tr>
<tr><td>${escHtml(L.loanAmount)}</td><td>${fmt(a.contrat.montant)} EUR (${escHtml(vars.LOAN_AMOUNT_WORDS)} ${langue === "FR" ? "euros" : "euros"})</td></tr>
<tr><td>${escHtml(L.purpose)}</td><td>${escHtml(a.contrat.objet)}</td></tr>
<tr><td>${escHtml(L.rate)}</td><td>${escHtml(vars.INTEREST_RATE)} %</td></tr>
<tr><td>${escHtml(L.termLabel)}</td><td>${a.contrat.dureeMois} ${escHtml(L.term)}</td></tr>
<tr><td>${escHtml(L.monthly)}</td><td>${fmt(a.contrat.mensualite)} EUR</td></tr>
<tr><td>${escHtml(L.total)}</td><td>${fmt(total)} EUR</td></tr>
<tr><td>${escHtml(L.interest)}</td><td>${fmt(interets)} EUR</td></tr>
<tr><td>${escHtml(L.disb)}</td><td>${escHtml(dateDoc(a.contrat.creeA))}</td></tr>
<tr><td>${escHtml(L.first)}</td><td>${lignes.length ? escHtml(dateDoc(lignes[0].date)) : "—"}</td></tr>
<tr><td>${escHtml(L.maturity)}</td><td>${lignes.length ? escHtml(dateDoc(lignes[lignes.length - 1].date)) : "—"}</td></tr>
</table>
<h2>${escHtml(L.annexeSchedule)}</h2>
<table><tr><th>${escHtml(L.thNum)}</th><th>${escHtml(L.thDate)}</th><th>${escHtml(L.thInst)}</th><th>${escHtml(L.thOut)}</th></tr>
${lignesAnnexe}
</table>
<footer>${escHtml(L.ref)}${escHtml(L.sep)} ${escHtml(a.contrat.reference || a.contrat.id)} — ${escHtml(dateDoc(a.contrat.majA))}</footer>
</body></html>`;
}
