/**
 * Banque — machine à états PURE (tranches 8 et 11).
 *
 * IBAN, soldes, réserves et transitions du pipeline de validation sont purs et testés en Node
 * (tests/unit/banque.spec.ts). La persistance a pris sa retraite navigateur à la tranche 11 :
 * l'état vit dans le magasin du serveur (lib/serveur-banque.ts + Route Handlers /api/banque),
 * qui applique CES fonctions sur intentions — l'UI ne calcule jamais l'état.
 *
 * Le pipeline de validation et les défauts bloquants (codes, coûts) viennent du référentiel
 * canonique `operations/virements.json` — « définis par l'administration » : les surcharges
 * vivent dans le magasin serveur ; le fichier reste la source.
 */
import referentielJSON from "../../operations/virements.json";

/** Dotation de démonstration versée à l'ouverture d'un compte client (étiquetée démo partout). */
export const MONTANT_DEMO = 2_500;

/* ——— Référentiel (table canonique + surcharges locales de l'administration) ——— */
export interface NiveauPipeline { code: string; pct: number }
/** Défaut bloquant : `pct` = niveau de la barre où le virement s'arrête tant que le code n'est pas fourni.
 *  `motif` = motif du paiement (clé i18n ou texte libre défini par l'administration), affiché au
 *  client à l'arrêt et dans ses transactions au dénouement. */
export interface DefautRef { code: string; pct: number; cout: number; actif: boolean; motif?: string }
export interface Referentiel { devise: string; pipeline: NiveauPipeline[]; defauts: DefautRef[] }
/** Surcharges d'administration : l'admin définit niveau (pct), montant (cout), statut (actif),
 *  motif du paiement — et crée de nouveaux champs de progression (`cree`). */
export type SurchargesReferentiel = Record<string, { cout?: number; actif?: boolean; pct?: number; motif?: string; cree?: boolean }>;

export const REFERENTIEL_CANONIQUE: Referentiel = referentielJSON;

/** Référentiel effectif : la table canonique, surcharges admin appliquées, champs créés ajoutés,
 *  et niveaux de progression supplémentaires insérés dans la barre (triés par pct). */
export function referentielEffectif(surcharges: SurchargesReferentiel = {}): Referentiel {
  const defauts: DefautRef[] = REFERENTIEL_CANONIQUE.defauts.map((d) => ({ ...d, ...surcharges[d.code] }));
  for (const [code, s] of Object.entries(surcharges)) {
    if (s.cree && !defauts.some((d) => d.code === code)) {
      defauts.push({ code, pct: s.pct ?? 100, cout: s.cout ?? 0, actif: s.actif ?? true, motif: s.motif });
    }
  }
  const pipeline = [...REFERENTIEL_CANONIQUE.pipeline];
  for (const pct of [...new Set(defauts.map((d) => d.pct))].sort((a, b) => a - b)) {
    if (!pipeline.some((n) => n.pct === pct)) pipeline.push({ code: `NIVEAU_${pct}`, pct });
  }
  pipeline.sort((a, b) => a.pct - b.pct);
  return { devise: REFERENTIEL_CANONIQUE.devise, pipeline, defauts };
}

/* ——— IBAN belge fictif, mais formellement valide (ISO 7064 mod 97) ——— */
/** Modulo 97 par division longue sur chaîne de chiffres (cible ES2017, sans BigInt). */
function mod97(chiffres: string): number {
  let reste = 0;
  for (let i = 0; i < chiffres.length; i++) reste = (reste * 10 + Number(chiffres[i])) % 97;
  return reste;
}

function graineTexte(s: string): number {
  let g = 2166136261;
  for (let i = 0; i < s.length; i++) { g ^= s.charCodeAt(i); g = Math.imul(g, 16777619) >>> 0; }
  return g >>> 0 || 1;
}

/** IBAN BE déterministe pour un identifiant de compte (même compte → même IBAN). */
export function genererIbanBE(identifiant: string): string {
  let x = graineTexte(identifiant);
  const suivant = () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x; };
  for (;;) {
    const banque = String(100 + (suivant() % 900));
    const compte = String(suivant() % 10_000_000).padStart(7, "0");
    const corps = banque + compte;
    let national = Number(corps) % 97;
    if (national === 0) national = 97;
    const base = corps + String(national).padStart(2, "0");
    // Checksum ISO 7064 : 98 − mod97(BBAN + lettres-pays en chiffres + « 00 »). B=11, E=14.
    // Un résultat < 2 est invalide (≈2 % des cas) : on tire alors le corps suivant.
    const iso = 98 - mod97(base + "1114" + "00");
    if (iso >= 2) return "BE" + String(iso).padStart(2, "0") + base;
  }
}

/** Vérification complète d'un IBAN BE : format 16 caractères + checksum mod 97. */
export function ibanBEValide(iban: string): boolean {
  const propre = iban.replace(/\s+/g, "").toUpperCase();
  if (!/^BE\d{14}$/.test(propre)) return false;
  const decale = propre.slice(4) + propre.slice(0, 4).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  return mod97(decale) === 1;
}

/** Longueurs officielles de l'IBAN par code pays (registre SWIFT) : un virement sortant peut
 *  viser n'importe quel pays, la validation reste stricte — structure, longueur et checksum. */
export const LONGUEURS_IBAN: Readonly<Record<string, number>> = {
  AD: 24, AE: 23, AL: 28, AO: 25, AT: 20, AZ: 28, BA: 20, BE: 16, BF: 27, BG: 22,
  BH: 22, BI: 16, BJ: 28, BR: 29, BY: 28, CH: 21, CI: 28, CM: 27, CR: 22, CV: 25,
  CY: 28, CZ: 24, DE: 22, DJ: 27, DK: 18, DO: 28, DZ: 26, EE: 20, EG: 29, ES: 24,
  FI: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23, GL: 18, GR: 27, GT: 28, HR: 21,
  HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28,
  LC: 32, LI: 21, LT: 20, LU: 20, LV: 21, LY: 25, MA: 28, MC: 27, MD: 24, ME: 22,
  MK: 19, MR: 27, MT: 31, MU: 30, MZ: 25, NL: 18, NO: 15, PK: 24, PL: 28, PS: 29,
  PT: 25, QA: 29, RO: 24, RS: 22, SA: 24, SC: 31, SD: 18, SE: 24, SI: 19, SK: 24,
  SM: 27, SN: 28, ST: 25, SV: 28, TL: 23, TN: 24, TR: 26, UA: 29, VA: 22, VG: 24, XK: 20,
};

/** Vérification d'un IBAN TOUS PAYS : 2 lettres pays + 2 chiffres + BBAN alphanumérique,
 *  longueur exacte du registre et checksum ISO 7064 mod 97 (les lettres deviennent des chiffres). */
export function ibanValide(iban: string): boolean {
  const propre = iban.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(propre)) return false;
  if (LONGUEURS_IBAN[propre.slice(0, 2)] !== propre.length) return false;
  // Les 4 premiers caractères passent à la fin, puis TOUTES les lettres deviennent des chiffres
  // (A=10 … Z=35) : certains BBAN contiennent des lettres (FR, NL, GB…).
  const decale = (propre.slice(4) + propre.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  return mod97(decale) === 1;
}

/* ——— Ledger : transactions et virements ——— */
export type SensTx = "entrant" | "sortant";
export interface Transaction {
  id: string; sens: SensTx; montant: number; date: string; contrepartie: string;
  motifCle?: string; motifLibre?: string; virementId?: string;
}

export type StatutVirement = "EN_COURS" | "BLOQUE" | "EXECUTE" | "REFUSE" | "ANNULE";
export interface Blocage { code: string; cout: number; depuis: string; leveA?: string; motif?: string }
export interface Virement {
  id: string; beneficiaireNom: string; beneficiaireIban: string;
  beneficiaireAdresse?: string; beneficiaireBic?: string;
  montant: number; motif: string;
  creeA: string; statut: StatutVirement; niveau: number; // dernier niveau atteint (0 = aucun)
  blocages: Blocage[];
  /** Code émis par l'administration pour débloquer le niveau d'arrêt courant (jamais servi au client). */
  codeDeblocage?: string;
}

export interface BanqueCompte {
  iban: string; verifie: boolean; photo: string | null;
  transactions: Transaction[]; virements: Virement[];
}

/** Solde du compte : entrants exécutés − sortants exécutés. Les réserves n'y touchent pas. */
export function soldeDe(compte: Pick<BanqueCompte, "transactions">): number {
  return compte.transactions.reduce(
    (acc, tx) => acc + (tx.sens === "entrant" ? tx.montant : -tx.montant), 0,
  );
}

/** Montant réservé par les virements non dénoués (en cours ou bloqués), frais de défaut inclus. */
export function reserveDe(virements: Virement[]): number {
  return virements
    .filter((v) => v.statut === "EN_COURS" || v.statut === "BLOQUE")
    .reduce((acc, v) => acc + v.montant + v.blocages.reduce((a, b) => a + (b.leveA ? 0 : b.cout), 0), 0);
}

export function disponibleDe(compte: BanqueCompte): number {
  return soldeDe(compte) - reserveDe(compte.virements);
}

/** Progression (%) d'un virement : le pct du dernier niveau confirmé. */
export function progressionDe(v: Virement, ref: Referentiel): number {
  return v.niveau > 0 ? ref.pipeline[Math.min(v.niveau, ref.pipeline.length) - 1].pct : 0;
}

/* ——— Machine à états (pure : renvoie le nouvel état, n'écrit rien) ——— */
/** Identifiant de virement : date + 4 caractères alphanumériques TIRÉS AU SORT, garantis uniques
 *  dans le compte (l'ancien compteur module redémarrait à 0 à chaque processus : deux virements
 *  pouvaient partager le même id — annuler l'un annulait alors l'autre). */
const ALPHABET_ID = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
export function idVirement(maintenant: string, existants: string[] = []): string {
  for (;;) {
    let s = "";
    for (let i = 0; i < 4; i++) s += ALPHABET_ID[Math.floor(Math.random() * ALPHABET_ID.length)];
    const id = `VIR-${maintenant.slice(0, 10).replace(/-/g, "")}-${s}`;
    if (!existants.includes(id)) return id;
  }
}

export function initierVirement(
  compte: BanqueCompte, beneficiaireNom: string, beneficiaireIban: string, montant: number, motif: string, maintenant: string,
  coordonnees?: { adresse?: string; bic?: string },
): { compte: BanqueCompte; erreur?: "non_verifie" | "iban_invalide" | "montant_invalide" } {
  if (!compte.verifie) return { compte, erreur: "non_verifie" };
  // Le bénéficiaire peut être domicilié dans n'importe quel pays : IBAN international valide.
  if (!ibanValide(beneficiaireIban)) return { compte, erreur: "iban_invalide" };
  if (!(montant > 0) || montant > disponibleDe(compte)) return { compte, erreur: "montant_invalide" };
  const v: Virement = {
    id: idVirement(maintenant, compte.virements.map((x) => x.id)), beneficiaireNom, beneficiaireIban: beneficiaireIban.replace(/\s+/g, "").toUpperCase(),
    beneficiaireAdresse: coordonnees?.adresse?.trim() || undefined,
    beneficiaireBic: coordonnees?.bic?.replace(/\s+/g, "").toUpperCase() || undefined,
    montant, motif, creeA: maintenant, statut: "EN_COURS", niveau: 0, blocages: [],
  };
  return { compte: { ...compte, virements: [...compte.virements, v] } };
}

/** Format BIC/SWIFT ISO 9362 : 4 lettres pays-banque + 2 lettres pays + 2 alphanum (+ 3 optionnels). */
export function bicValide(bic: string): boolean {
  return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic.replace(/\s+/g, "").toUpperCase());
}

/* ——— Pipeline auto-évolutif (slice 15) : la barre avance seule, s'arrête aux défauts actifs ——— */

/** Arrêts actifs du référentiel : défauts actifs groupés par pct, pct croissants. */
export function arretsActifs(ref: Referentiel): Array<{ pct: number; defauts: DefautRef[] }> {
  const par = new Map<number, DefautRef[]>();
  for (const d of ref.defauts.filter((x) => x.actif)) par.set(d.pct, [...(par.get(d.pct) ?? []), d]);
  return [...par.entries()].map(([pct, defauts]) => ({ pct, defauts })).sort((a, b) => a.pct - b.pct);
}

function niveauPourPct(ref: Referentiel, pct: number): number {
  return ref.pipeline.findIndex((n) => n.pct === pct) + 1;
}

/**
 * Évolution automatique : le virement EN_COURS avance jusqu'au premier arrêt dont le pct dépasse
 * sa progression — il y reste BLOQUE (défauts du niveau + code de déblocage fourni par le serveur) ;
 * sans arrêt restant, il atteint le dernier niveau et passe EXECUTE.
 */
export function evolutionVirement(compte: BanqueCompte, virementId: string, ref: Referentiel, codeDeblocage: string, maintenant: string): BanqueCompte {
  return mapVirement(compte, virementId, (v) => {
    if (v.statut !== "EN_COURS") return v;
    const arret = arretsActifs(ref).find((a) => a.pct > progressionDe(v, ref));
    if (!arret) return { ...v, niveau: ref.pipeline.length, statut: "EXECUTE", codeDeblocage: undefined };
    return {
      ...v,
      niveau: niveauPourPct(ref, arret.pct),
      statut: "BLOQUE",
      blocages: [...v.blocages, ...arret.defauts.map((d) => ({ code: d.code, cout: d.cout, depuis: maintenant, motif: d.motif ?? `banque:defaut.${d.code}` }))],
      codeDeblocage,
    };
  });
}

/** Le client renseigne le code émis par l'administration : le niveau se débloque et la machine repart. */
export function debloquerParCode(compte: BanqueCompte, virementId: string, code: string, maintenant: string): { compte: BanqueCompte; ok: boolean } {
  const v = compte.virements.find((x) => x.id === virementId);
  const propre = String(code ?? "").trim().toUpperCase();
  if (!v || v.statut !== "BLOQUE" || !v.codeDeblocage || propre !== v.codeDeblocage) return { compte, ok: false };
  return {
    compte: mapVirement(compte, virementId, (x) => ({
      ...x,
      statut: "EN_COURS",
      codeDeblocage: undefined,
      blocages: x.blocages.map((b) => (b.leveA ? b : { ...b, leveA: maintenant })),
    })),
    ok: true,
  };
}

/** Surcharges d'administration : lever un blocage sans code (geste commercial) remet la machine en marche. */
export function leverBlocage(compte: BanqueCompte, virementId: string, maintenant: string): BanqueCompte {
  return mapVirement(compte, virementId, (v) => {
    if (v.statut !== "BLOQUE") return v;
    const blocages = v.blocages.map((b) => (b.leveA ? b : { ...b, leveA: maintenant }));
    return { ...v, statut: "EN_COURS", blocages, codeDeblocage: undefined };
  });
}

/** Exécute un virement EXECUTE dans le ledger : débit du montant, puis une transaction de frais par
 *  défaut levé — le MOTIF DU PAIEMENT défini par l'administration apparaît ainsi dans le compte du
 *  client lors du dénouement. */
export function denouer(compte: BanqueCompte, virementId: string, maintenant: string): BanqueCompte {
  const v = compte.virements.find((x) => x.id === virementId);
  if (!v || v.statut !== "EXECUTE") return compte;
  if (compte.transactions.some((tx) => tx.virementId === virementId)) return compte;
  const txs: Transaction[] = [{
    id: `TX-${virementId}`, sens: "sortant", montant: v.montant, date: maintenant,
    contrepartie: v.beneficiaireNom, motifLibre: v.motif, virementId,
  }];
  for (const b of v.blocages.filter((x) => x.cout > 0)) {
    txs.push({
      id: `TX-${virementId}-${b.code}`, sens: "sortant", montant: b.cout, date: maintenant,
      contrepartie: "KREDIT", motifLibre: b.motif ?? `banque:defaut.${b.code}`, virementId,
    });
  }
  return { ...compte, transactions: [...compte.transactions, ...txs] };
}

export function refuserVirement(compte: BanqueCompte, virementId: string): BanqueCompte {
  return statuer(compte, virementId, "REFUSE");
}
export function annulerVirement(compte: BanqueCompte, virementId: string): BanqueCompte {
  return statuer(compte, virementId, "ANNULE");
}

function statuer(compte: BanqueCompte, virementId: string, statut: StatutVirement): BanqueCompte {
  return mapVirement(compte, virementId, (v) =>
    v.statut === "EN_COURS" || v.statut === "BLOQUE" ? { ...v, statut } : v,
  );
}

function mapVirement(compte: BanqueCompte, virementId: string, f: (v: Virement) => Virement): BanqueCompte {
  return { ...compte, virements: compte.virements.map((v) => (v.id === virementId ? f(v) : v)) };
}

/* ——— Ouverture de compte : IBAN fictif + dotation de démonstration, étiquetée telle quelle ——— */
export function ouvrirBanqueClient(email: string, role: string, maintenant: string): BanqueCompte {
  const tx: Transaction = {
    id: `TX-DEMO-${Date.now()}`, sens: "entrant", montant: MONTANT_DEMO, date: maintenant,
    contrepartie: "KREDIT", motifCle: "banque.tx.demoGrant",
  };
  return { iban: genererIbanBE(`${email.toLowerCase()}::${role}`), verifie: false, photo: null, transactions: [tx], virements: [] };
}

/* ——— Identifiants & messages ——— */
export const cleBanque = (email: string, role: string) => `${email.trim().toLowerCase()}::${role}`;

export interface MessageChat { id: string; de: "client" | "support"; auteur: string; texte: string; ts: string }
