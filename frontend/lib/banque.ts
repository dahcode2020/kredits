/**
 * Slice 8 — banque locale de démonstration (SANS backend, l'UI le dit).
 *
 * Pur autant que possible : IBAN, soldes et machine à états du pipeline sont testés en Node
 * (tests/unit/banque.spec.ts). Le localStorage n'est touché que dans les fonctions de lecture et
 * d'écriture de la persistance (jamais au render — contrat d'hydratation).
 *
 * Le pipeline de validation et les défauts bloquants (codes, coûts) viennent du référentiel
 * canonique `operations/virements.json` — « définis par l'administration » : en démo, des
 * surcoûts locaux (kredit.referentiel.v1) peuvent les ajuster ; le fichier reste la source.
 */
import referentielJSON from "../../operations/virements.json";

export const CLE_BANQUE = "kredit.banque.v1";
export const CLE_CHAT = "kredit.chat.v1";
export const CLE_REFERENTIEL_LOCAL = "kredit.referentiel.v1";

/** Dotation de démonstration versée à l'ouverture d'un compte client (étiquetée démo partout). */
export const MONTANT_DEMO = 2_500;

/* ——— Référentiel (table canonique + surcharges locales de l'administration) ——— */
export interface NiveauPipeline { code: string; pct: number }
export interface DefautRef { code: string; cout: number; actif: boolean }
export interface Referentiel { devise: string; pipeline: NiveauPipeline[]; defauts: DefautRef[] }
export type SurchargesReferentiel = Record<string, { cout?: number; actif?: boolean }>;

export const REFERENTIEL_CANONIQUE: Referentiel = referentielJSON;

/** Référentiel effectif : la table canonique, avec les surcharges locales appliquées. */
export function referentielEffectif(surcharges: SurchargesReferentiel = {}): Referentiel {
  return {
    devise: REFERENTIEL_CANONIQUE.devise,
    pipeline: REFERENTIEL_CANONIQUE.pipeline,
    defauts: REFERENTIEL_CANONIQUE.defauts.map((d) => ({ ...d, ...surcharges[d.code] })),
  };
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

/* ——— Ledger : transactions et virements ——— */
export type SensTx = "entrant" | "sortant";
export interface Transaction {
  id: string; sens: SensTx; montant: number; date: string; contrepartie: string;
  motifCle?: string; motifLibre?: string; virementId?: string;
}

export type StatutVirement = "EN_COURS" | "BLOQUE" | "EXECUTE" | "REFUSE" | "ANNULE";
export interface Blocage { code: string; cout: number; depuis: string; leveA?: string }
export interface Virement {
  id: string; beneficiaireNom: string; beneficiaireIban: string; montant: number; motif: string;
  creeA: string; statut: StatutVirement; niveau: number; // dernier niveau confirmé (0 = aucun)
  blocages: Blocage[];
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
let compteurId = 0;
export function idVirement(maintenant: string): string {
  compteurId = (compteurId + 1) % 1000;
  return `VIR-${maintenant.slice(0, 10).replace(/-/g, "")}-${String(compteurId).padStart(3, "0")}`;
}

export function initierVirement(
  compte: BanqueCompte, beneficiaireNom: string, beneficiaireIban: string, montant: number, motif: string, maintenant: string,
): { compte: BanqueCompte; erreur?: "non_verifie" | "iban_invalide" | "montant_invalide" } {
  if (!compte.verifie) return { compte, erreur: "non_verifie" };
  if (!ibanBEValide(beneficiaireIban)) return { compte, erreur: "iban_invalide" };
  if (!(montant > 0) || montant > disponibleDe(compte)) return { compte, erreur: "montant_invalide" };
  const v: Virement = {
    id: idVirement(maintenant), beneficiaireNom, beneficiaireIban: beneficiaireIban.replace(/\s+/g, "").toUpperCase(),
    montant, motif, creeA: maintenant, statut: "EN_COURS", niveau: 0, blocages: [],
  };
  return { compte: { ...compte, virements: [...compte.virements, v] } };
}

/** L'administration confirme le niveau suivant ; au dernier niveau le virement est exécuté. */
export function confirmerNiveau(compte: BanqueCompte, virementId: string, ref: Referentiel): BanqueCompte {
  return mapVirement(compte, virementId, (v) => {
    if (v.statut !== "EN_COURS" || v.niveau >= ref.pipeline.length) return v;
    const niveau = v.niveau + 1;
    const execute = niveau === ref.pipeline.length;
    return { ...v, niveau, statut: execute ? "EXECUTE" : "EN_COURS" };
  });
}

/** Exécute un virement EXECUTE dans le ledger : débit montant + frais des défauts levés. */
export function denouer(compte: BanqueCompte, virementId: string, maintenant: string): BanqueCompte {
  const v = compte.virements.find((x) => x.id === virementId);
  if (!v || v.statut !== "EXECUTE") return compte;
  if (compte.transactions.some((tx) => tx.virementId === virementId)) return compte;
  const frais = v.blocages.reduce((a, b) => a + b.cout, 0);
  const tx: Transaction = {
    id: `TX-${virementId}`, sens: "sortant", montant: v.montant + frais, date: maintenant,
    contrepartie: v.beneficiaireNom, motifLibre: v.motif, virementId,
  };
  return { ...compte, transactions: [...compte.transactions, tx] };
}

/** L'administration bloque un virement pour un défaut du référentiel (code + coût). */
export function bloquerVirement(compte: BanqueCompte, virementId: string, codeDefaut: string, ref: Referentiel, maintenant: string): BanqueCompte {
  const defaut = ref.defauts.find((d) => d.code === codeDefaut && d.actif);
  if (!defaut) return compte;
  return mapVirement(compte, virementId, (v) =>
    v.statut !== "EN_COURS" ? v : { ...v, statut: "BLOQUE", blocages: [...v.blocages, { code: defaut.code, cout: defaut.cout, depuis: maintenant }] },
  );
}

/** Le défaut est résolu : le virement repart du niveau où il s'était arrêté. */
export function leverBlocage(compte: BanqueCompte, virementId: string, maintenant: string): BanqueCompte {
  return mapVirement(compte, virementId, (v) => {
    if (v.statut !== "BLOQUE") return v;
    const blocages = v.blocages.map((b) => (b.leveA ? b : { ...b, leveA: maintenant }));
    return { ...v, statut: "EN_COURS", blocages };
  });
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

/* ——— Persistance locale (navigateur uniquement) ——— */
type Carte<T> = Record<string, T>;
function lireCarte<T>(cle: string): Carte<T> {
  try {
    const brut = window.localStorage.getItem(cle);
    const obj = brut ? JSON.parse(brut) : {};
    return obj && typeof obj === "object" && !Array.isArray(obj) ? (obj as Carte<T>) : {};
  } catch { return {}; }
}
function ecrireCarte<T>(cle: string, carte: Carte<T>): void {
  try { window.localStorage.setItem(cle, JSON.stringify(carte)); } catch { /* navigation privée */ }
}

export const cleBanque = (email: string, role: string) => `${email.trim().toLowerCase()}::${role}`;

export function lireBanque(email: string, role: string): BanqueCompte | null {
  return lireCarte<BanqueCompte>(CLE_BANQUE)[cleBanque(email, role)] ?? null;
}
export function lireBanques(): Carte<BanqueCompte> {
  return lireCarte<BanqueCompte>(CLE_BANQUE);
}
export function enregistrerBanque(email: string, role: string, compte: BanqueCompte): void {
  ecrireCarte(CLE_BANQUE, { ...lireCarte<BanqueCompte>(CLE_BANQUE), [cleBanque(email, role)]: compte });
}

export interface MessageChat { id: string; de: "client" | "support"; auteur: string; texte: string; ts: string }
export function lireChat(idCompte: string): MessageChat[] {
  return lireCarte<MessageChat[]>(CLE_CHAT)[idCompte] ?? [];
}
export function ajouterMessageChat(idCompte: string, message: MessageChat): MessageChat[] {
  const liste = [...lireChat(idCompte), message];
  ecrireCarte(CLE_CHAT, { ...lireCarte<MessageChat[]>(CLE_CHAT), [idCompte]: liste });
  return liste;
}

export function lireSurchargesReferentiel(): SurchargesReferentiel {
  return lireCarte<SurchargesReferentiel>(CLE_REFERENTIEL_LOCAL)["defauts"] ?? {};
}
export function enregistrerSurchargesReferentiel(surcharges: SurchargesReferentiel): void {
  ecrireCarte(CLE_REFERENTIEL_LOCAL, { defauts: surcharges });
}
