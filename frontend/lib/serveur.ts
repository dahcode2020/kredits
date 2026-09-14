/**
 * Slice 10 — domaine du serveur d'authentification et d'API (Route Handlers Node).
 *
 * Pur et testable sans HTTP (tests/unit/serveur.spec.ts) : le stockage est injecté par dossier,
 * le hachage est scrypt salé (jamais de mot de passe en clair, jamais de SHA-256 simple côté
 * serveur), les sessions sont des jetons aléatoires conservés côté serveur avec expiration.
 *
 * Le point d'honneur : l'API lit les MÊMES tables canoniques que le frontend —
 * rate_be/grille.json via les exports de lib/credit-engine (grillePourApi, simulerServeur).
 * Un seul endroit par valeur, des deux côtés du réseau.
 *
 * Démo honnête : les comptes du personnel sont semés à la première ouverture du magasin avec des
 * mots de passe de démonstration affichés comme tels dans l'UI ; le magasin vit sur disque local.
 */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DOCUMENT_CODES, GRILLE, GRILLE_VERSION, HISTORIQUE_GRILLES, chainonValide, grilleValideA,
  reglesDeEntree, simulateCredit, type SimulateInput,
} from "@/lib/credit-engine";

import { COMPTES_PORTE_DEMO, type RoleServeur } from "@/lib/serveur-demo";
import type { BanqueCompte, MessageChat, SurchargesReferentiel } from "@/lib/banque";
import type { EtatSimulation } from "@/lib/application";
export type { RoleServeur };
export { COMPTES_PORTE_DEMO };

/** Demande de crédit côté serveur : un seul endroit par valeur — le navigateur ne garde qu'un
 *  miroir local de courtoisie, l'espace client lit CETTE table (voir /api/demandes). */
export interface DemandeServeur {
  id: string; email: string; nom: string; telephone: string;
  creeA: string; statut: "SUBMITTED"; etat: EtatSimulation;
}

/** Paiements & charges du client (menu Paiements). Trois natures :
 *  - VIREMENT_ENTRANT : crédit déposé par l'administration sur le compte (déjà encaissé) ;
 *  - MENSUALITE : échéance d'un crédit en cours ;
 *  - FRAIS : charge liée à une demande de crédit (frais de dossier, certificat…).
 *  Cycle d'une charge : EN_ATTENTE (créée par l'admin) → le client la règle → DECLARE (paiement
 *  déclaré, en attente de confirmation) → l'admin la marque payée → PAYE. Le `libelle` est une
 *  clé i18n ou du texte libre (résolu par `tSiCle` à l'affichage). */
export type TypePaiement = "VIREMENT_ENTRANT" | "MENSUALITE" | "FRAIS";
export type StatutPaiement = "EN_ATTENTE" | "DECLARE" | "PAYE";
export interface PaiementServeur {
  id: string; email: string; type: TypePaiement; libelle: string;
  montant: number; creeA: string; echeance?: string; demandeId?: string;
  statut: StatutPaiement; regleA?: string; confirmeA?: string;
}

/** Document justificatif téléversé par le client (menu Documents) et vérifié par
 *  l'administration : SOUMIS → l'admin le lit et l'approuve → APPROUVE, le client est
 *  notifié et la mention « approuvé » apparaît dans son menu Documents. Le fichier voyage
 *  en dataURL (démo locale, plafonné) ; `code` est un code du moteur (DOCUMENT_CODES). */
export type StatutDocument = "SOUMIS" | "APPROUVE";
export interface DocumentServeur {
  id: string; email: string; demandeId: string; code: string; nom: string;
  donnees: string; taille: number; creeA: string;
  statut: StatutDocument; approuveA?: string; approuvePar?: string;
}

/** Notification au client (ex. document approuvé) : une clé i18n + ses variables, jamais de
 *  texte en dur. */
export interface NotificationServeur {
  id: string; email: string; cle: string; vars?: Record<string, string>; creeA: string;
}

/** Taille maximale d'un document téléversé (dataURL comprise) — même plafond que la photo. */
export const DOCUMENT_MAX_OCTETS = 5 * 1024 * 1024;

export interface CompteServeur {
  email: string; role: RoleServeur; nom: string; creeA: string;
  sel: string; hash: string; profil?: Record<string, string>;
}
export interface SessionServeur {
  jeton: string; email: string; role: RoleServeur; nom: string; ouverteA: string; expireA: string;
}
export interface Magasin {
  comptes: CompteServeur[]; sessions: SessionServeur[];
  banques?: Record<string, BanqueCompte>;
  chats?: Record<string, MessageChat[]>;
  surcharges?: SurchargesReferentiel;
  demandes?: DemandeServeur[];
  paiements?: PaiementServeur[];
  documents?: DocumentServeur[];
  notifications?: NotificationServeur[];
  /** Version du format de données : un magasin d'une autre version est re-semé, jamais migré à
   *  l'aveugle — aucun vieux fichier ne peut produire des comportements fantômes après un déploiement. */
  versionMagasin?: number;
}

/** À incrémenter à chaque changement de forme des données du magasin. */
export const VERSION_MAGASIN = 5;

export const DUREE_SESSION_JOURS = 7;
export const NOM_COOKIE = "kredit_session_v1";

/* ——— Mot de passe : scrypt salé ——— */
export function hacherMotDePasse(motDePasse: string, sel: string): string {
  return scryptSync(motDePasse, sel, 64).toString("hex");
}
export function nouveauSel(): string {
  return randomBytes(16).toString("hex");
}
export function verifierMotDePasse(motDePasse: string, sel: string, hashAttendu: string): boolean {
  const calcule = Buffer.from(hacherMotDePasse(motDePasse, sel), "hex");
  const attendu = Buffer.from(hashAttendu, "hex");
  return calcule.length === attendu.length && timingSafeEqual(calcule, attendu);
}

/* ——— Magasin fichiers (un dossier, deux fichiers JSON, atomique par réécriture complète) ——— */
export function dossierDonnees(): string {
  return process.env.KREDIT_DATA_DIR || join(process.cwd(), ".serveur");
}
function cheminMagasin(dossier: string): string {
  return join(dossier, "magasin.json");
}
export function lireMagasin(dossier: string = dossierDonnees()): Magasin {
  const chemin = cheminMagasin(dossier);
  let magasin: Magasin = { comptes: [], sessions: [] };
  if (existsSync(chemin)) {
    try { magasin = JSON.parse(readFileSync(chemin, "utf8")) as Magasin; } catch { magasin = { comptes: [], sessions: [] }; }
  }
  // Un magasin d'une autre version (vieux déploiement, ids dupliqués, champs manquants…) est
  // jeté et re-semé : le comportement repart toujours de l'état neuf du code courant.
  if (magasin.versionMagasin !== VERSION_MAGASIN) magasin = { comptes: [], sessions: [], versionMagasin: VERSION_MAGASIN };
  if (!magasin.comptes.some((c) => c.role !== "CUSTOMER")) semerPersonnel(magasin);
  if (!magasin.demandes) semerDemandesDemo(magasin);
  if (!magasin.paiements) semerPaiementsDemo(magasin);
  if (!magasin.documents) semerDocumentsDemo(magasin);
  return magasin;
}
export function ecrireMagasin(magasin: Magasin, dossier: string = dossierDonnees()): void {
  mkdirSync(dossier, { recursive: true });
  magasin.versionMagasin = VERSION_MAGASIN;
  writeFileSync(cheminMagasin(dossier), JSON.stringify(magasin, null, 2), "utf8");
}
function semerPersonnel(magasin: Magasin): void {
  for (const porte of COMPTES_PORTE_DEMO) {
    if (magasin.comptes.some((c) => c.email === porte.email)) continue;
    const sel = nouveauSel();
    magasin.comptes.push({
      email: porte.email, role: porte.role, nom: porte.nom, creeA: new Date().toISOString(),
      sel, hash: hacherMotDePasse(porte.motDePasse, sel), profil: porte.profil,
    });
  }
}

/** Demandes de démonstration du client vitrine : deux demandes EN COURS d'examen, construites
 *  avec les mêmes bornes que le simulateur. L'espace client affiche ainsi un aperçu réel dès la
 *  première connexion, et la règle « une seule demande en cours par catégorie » devient visible. */
function semerDemandesDemo(magasin: Magasin): void {
  magasin.demandes = [
    {
      id: "KRD-2026-DEMOA1", email: "client@kredit.be", nom: "Client KREDIT", telephone: "+32 470 12 34 56",
      creeA: "2026-09-08T09:15:00.000Z", statut: "SUBMITTED",
      etat: {
        product: "PERSONAL", amount: 15_000, term: 48, income: 2_800, charges: 950,
        existing: 0, incomeType: "SALARY", employment: "CDI", purpose: "CONSUMPTION",
      },
    },
    {
      id: "KRD-2026-DEMOB2", email: "client@kredit.be", nom: "Client KREDIT", telephone: "+32 470 12 34 56",
      creeA: "2026-09-12T14:40:00.000Z", statut: "SUBMITTED",
      etat: {
        product: "MORTGAGE", amount: 95_000, term: 240, income: 2_800, charges: 950,
        existing: 0, incomeType: "SALARY", employment: "CDI", purpose: "WORKS",
      },
    },
  ];
}

/** Paiements de démonstration du client vitrine — trois états du menu Paiements illustrés :
 *  un virement entrant de l'administration (encaissé, correspond au salaire semé en banque),
 *  des frais de dossier EN ATTENTE sur la demande PERSONAL, et la première mensualité de cette
 *  même demande, calculée par LE moteur (jamais un montant écrit à la main). */
function semerPaiementsDemo(magasin: Magasin): void {
  const demande = (magasin.demandes ?? []).find((d) => d.id === "KRD-2026-DEMOA1");
  const mensualite = demande
    ? Math.round(simulateCredit({
        amount: demande.etat.amount, termMonths: demande.etat.term, monthlyIncome: demande.etat.income,
        monthlyCharges: demande.etat.charges, incomeType: demande.etat.incomeType,
        employmentStatus: demande.etat.employment, loanPurpose: demande.etat.purpose,
        existingCreditsMonthly: demande.etat.existing, country: "BE", productType: demande.etat.product,
      }).simulation.monthlyPayment * 100) / 100
    : 0;
  magasin.paiements = [
    {
      id: "PAY-2026-DEMOA1", email: "client@kredit.be", type: "VIREMENT_ENTRANT",
      libelle: "banque.tx.demoSalary", montant: 1_850, creeA: "2026-09-05T06:00:00.000Z",
      statut: "PAYE", regleA: "2026-09-05T06:00:00.000Z", confirmeA: "2026-09-05T06:00:00.000Z",
    },
    {
      id: "PAY-2026-DEMOB2", email: "client@kredit.be", type: "FRAIS",
      libelle: "payments.seed.dossierFee", montant: 150, creeA: "2026-09-09T10:00:00.000Z",
      echeance: "2026-09-25", demandeId: "KRD-2026-DEMOA1", statut: "EN_ATTENTE",
    },
    ...(mensualite > 0 ? [{
      id: "PAY-2026-DEMOC3", email: "client@kredit.be", type: "MENSUALITE" as TypePaiement,
      libelle: "payments.seed.monthlyOne", montant: mensualite, creeA: "2026-09-08T09:15:00.000Z",
      echeance: "2026-10-08", demandeId: "KRD-2026-DEMOA1", statut: "EN_ATTENTE" as StatutPaiement,
    }] : []),
  ];
}

/* ——— Documents justificatifs : téléversés par le client, approuvés par l'administration ——— */
function texteDemoBase64(lignes: string): string {
  return `data:text/plain;base64,${Buffer.from(lignes, "utf8").toString("base64")}`;
}
/** Documents de démonstration du client vitrine : une pièce APPROUVÉE (avec sa notification)
 *  et une pièce SOUMISE que l'administration peut approuver en direct. */
function semerDocumentsDemo(magasin: Magasin): void {
  magasin.documents = [
    {
      id: "DOC-2026-DEMOA1", email: "client@kredit.be", demandeId: "KRD-2026-DEMOA1", code: "ID",
      nom: "carte-identite-demo.txt", donnees: texteDemoBase64("KREDIT — document de démonstration : carte d'identité (fictive)."),
      taille: 2048, creeA: "2026-09-09T08:20:00.000Z",
      statut: "APPROUVE", approuveA: "2026-09-11T09:30:00.000Z", approuvePar: "Admin KREDIT",
    },
    {
      id: "DOC-2026-DEMOB2", email: "client@kredit.be", demandeId: "KRD-2026-DEMOA1", code: "INCOME_3M",
      nom: "fiches-paie-demo.txt", donnees: texteDemoBase64("KREDIT — document de démonstration : fiches de paie (fictives)."),
      taille: 8192, creeA: "2026-09-12T15:05:00.000Z", statut: "SOUMIS",
    },
  ];
  magasin.notifications = [
    {
      id: "NOTIF-2026-DEMOA1", email: "client@kredit.be", cle: "documents.notify.approved",
      vars: { doc: "credit:documents.ID" }, creeA: "2026-09-11T09:30:00.000Z",
    },
  ];
}

let compteurDocument = 0;
function idDocument(maintenant: string, existants: string[]): string {
  for (;;) {
    compteurDocument += 1;
    const id = `DOC-${maintenant.slice(0, 10).replace(/-/g, "")}-${Math.floor(Math.random() * 46_656).toString(36).toUpperCase().padStart(3, "0")}${(compteurDocument % 36).toString(36).toUpperCase()}`;
    if (!existants.includes(id)) return id;
  }
}
export function documentsPour(magasin: Magasin, email: string): DocumentServeur[] {
  const e = email.trim().toLowerCase();
  return (magasin.documents ?? []).filter((d) => d.email === e);
}
/** Le client dépose une pièce pour une demande : un dépôt remplace le précédent TANT QU'IL
 *  N'EST PAS approuvé (une pièce approuvée est figée). Le fichier est borné et validé. */
export function deposerDocument(
  magasin: Magasin,
  d: { email: string; demandeId: string; code: string; nom: string; donnees: string; taille: number; maintenant: string },
): { document?: DocumentServeur; erreur?: "code_invalide" | "fichier_invalide" | "trop_lourd" | "champs_manquants" } {
  if (!(DOCUMENT_CODES as readonly string[]).includes(d.code)) return { erreur: "code_invalide" };
  if (!d.demandeId.trim() || !d.nom.trim()) return { erreur: "champs_manquants" };
  if (typeof d.donnees !== "string" || !d.donnees.startsWith("data:")) return { erreur: "fichier_invalide" };
  if (d.taille <= 0 || d.taille > DOCUMENT_MAX_OCTETS || d.donnees.length > DOCUMENT_MAX_OCTETS * 2) return { erreur: "trop_lourd" };
  const existant = (magasin.documents ?? []).find(
    (x) => x.email === d.email.trim().toLowerCase() && x.demandeId === d.demandeId && x.code === d.code,
  );
  if (existant?.statut === "APPROUVE") return { erreur: "code_invalide" }; // pièce approuvée : figée
  const document: DocumentServeur = {
    id: existant?.id ?? idDocument(d.maintenant, (magasin.documents ?? []).map((x) => x.id)),
    email: d.email.trim().toLowerCase(), demandeId: d.demandeId.trim(), code: d.code,
    nom: d.nom.trim().slice(0, 120), donnees: d.donnees, taille: d.taille, creeA: d.maintenant, statut: "SOUMIS",
  };
  magasin.documents = existant
    ? (magasin.documents ?? []).map((x) => (x.id === existant.id ? document : x))
    : [...(magasin.documents ?? []), document];
  return { document };
}
/** L'administration approuve une pièce soumise : le statut change ET le client est notifié
 *  (il le constate dans son menu Documents et dans ses notifications). */
export function approuverDocument(
  magasin: Magasin, documentId: string, par: string, maintenant: string,
): { document?: DocumentServeur; erreur?: "introuvable" | "etat_inchange" } {
  const doc = (magasin.documents ?? []).find((x) => x.id === documentId);
  if (!doc) return { erreur: "introuvable" };
  if (doc.statut === "APPROUVE") return { erreur: "etat_inchange" };
  doc.statut = "APPROUVE"; doc.approuveA = maintenant; doc.approuvePar = par;
  magasin.notifications = [...(magasin.notifications ?? []), {
    id: `NOTIF-${documentId}-${maintenant.replace(/[^0-9]/g, "").slice(-8)}`,
    email: doc.email, cle: "documents.notify.approved", vars: { doc: `credit:documents.${doc.code}` }, creeA: maintenant,
  }];
  return { document: doc };
}
export function notificationsPour(magasin: Magasin, email: string): NotificationServeur[] {
  const e = email.trim().toLowerCase();
  return (magasin.notifications ?? []).filter((n) => n.email === e);
}

/* ——— Paiements & charges : chaque client ne voit que les siens ——— */
let compteurPaiement = 0;
export function idPaiement(maintenant: string, existants: string[] = []): string {
  for (;;) {
    compteurPaiement += 1;
    const id = `PAY-${maintenant.slice(0, 10).replace(/-/g, "")}-${Math.floor(Math.random() * 46_656).toString(36).toUpperCase().padStart(3, "0")}${(compteurPaiement % 36).toString(36).toUpperCase()}`;
    if (!existants.includes(id)) return id;
  }
}
export function paiementsPour(magasin: Magasin, email: string): PaiementServeur[] {
  const e = email.trim().toLowerCase();
  return (magasin.paiements ?? []).filter((p) => p.email === e);
}
/** L'administration crée une charge (mensualité ou frais) à régler par le client. */
export function creerPaiement(
  magasin: Magasin,
  d: { email: string; type: TypePaiement; libelle: string; montant: number; maintenant: string; echeance?: string; demandeId?: string },
): PaiementServeur | { erreur: "montant_invalide" | "type_invalide" } {
  if (d.type !== "MENSUALITE" && d.type !== "FRAIS") return { erreur: "type_invalide" };
  if (!Number.isFinite(d.montant) || d.montant <= 0) return { erreur: "montant_invalide" };
  const paiement: PaiementServeur = {
    id: idPaiement(d.maintenant, (magasin.paiements ?? []).map((p) => p.id)),
    email: d.email.trim().toLowerCase(), type: d.type, libelle: d.libelle.trim().slice(0, 160),
    montant: Math.round(d.montant * 100) / 100, creeA: d.maintenant,
    echeance: d.echeance || undefined, demandeId: d.demandeId || undefined, statut: "EN_ATTENTE",
  };
  magasin.paiements = [...(magasin.paiements ?? []), paiement];
  return paiement;
}
/** Le client règle une charge : son paiement est DÉCLARÉ — il devient PAYE quand
 *  l'administration le confirme (le serveur fait foi des deux côtés). */
export function reglerPaiement(magasin: Magasin, paiementId: string, email: string, maintenant: string): { paiement?: PaiementServeur; erreur?: "introuvable" | "etat_inchange" } {
  const p = (magasin.paiements ?? []).find((x) => x.id === paiementId && x.email === email.trim().toLowerCase());
  if (!p) return { erreur: "introuvable" };
  if (p.statut !== "EN_ATTENTE") return { erreur: "etat_inchange" };
  p.statut = "DECLARE"; p.regleA = maintenant;
  return { paiement: p };
}
/** Un crédit déposé par l'administration sur le compte du client : virement entrant déjà
 *  encaissé (les fonds sont arrivés), listé tel quel dans le menu Paiements du client. */
export function enregistrerVirementEntrant(magasin: Magasin, email: string, montant: number, libelle: string, maintenant: string): PaiementServeur {
  const paiement: PaiementServeur = {
    id: idPaiement(maintenant, (magasin.paiements ?? []).map((p) => p.id)),
    email: email.trim().toLowerCase(), type: "VIREMENT_ENTRANT", libelle: libelle.trim().slice(0, 160) || "banque.tx.in",
    montant: Math.round(montant * 100) / 100, creeA: maintenant, statut: "PAYE",
    regleA: maintenant, confirmeA: maintenant,
  };
  magasin.paiements = [...(magasin.paiements ?? []), paiement];
  return paiement;
}

/** L'administration marque la charge payée (depuis DECLARE — le client a réglé — ou depuis
 *  EN_ATTENTE, par ex. règlement hors application). */
export function confirmerPaiement(magasin: Magasin, paiementId: string, maintenant: string): { paiement?: PaiementServeur; erreur?: "introuvable" | "etat_inchange" } {
  const p = (magasin.paiements ?? []).find((x) => x.id === paiementId);
  if (!p) return { erreur: "introuvable" };
  if (p.statut === "PAYE") return { erreur: "etat_inchange" };
  p.statut = "PAYE"; p.confirmeA = maintenant;
  if (!p.regleA) p.regleA = maintenant;
  return { paiement: p };
}

/* ——— Demandes de crédit : chaque client ne voit que les siennes ——— */
export function demandesPour(magasin: Magasin, email: string): DemandeServeur[] {
  const e = email.trim().toLowerCase();
  return (magasin.demandes ?? []).filter((d) => d.email === e);
}
export function deposerDemandeServeur(magasin: Magasin, d: DemandeServeur): DemandeServeur {
  magasin.demandes = [...(magasin.demandes ?? []), d];
  return d;
}

/* ——— Comptes ——— */
export function trouverCompte(magasin: Magasin, email: string, role: RoleServeur): CompteServeur | null {
  const e = email.trim().toLowerCase();
  return magasin.comptes.find((c) => c.email === e && c.role === role) ?? null;
}
export function creerCompte(
  magasin: Magasin,
  donnees: { email: string; motDePasse: string; role: RoleServeur; nom: string; profil?: Record<string, string> },
): CompteServeur | { erreur: "existant" | "invalide" } {
  const email = donnees.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { erreur: "invalide" };
  if (donnees.motDePasse.length < 8) return { erreur: "invalide" };
  if (!donnees.nom.trim()) return { erreur: "invalide" };
  if (trouverCompte(magasin, email, donnees.role)) return { erreur: "existant" };
  const sel = nouveauSel();
  const compte: CompteServeur = {
    email, role: donnees.role, nom: donnees.nom.trim(), creeA: new Date().toISOString(),
    sel, hash: hacherMotDePasse(donnees.motDePasse, sel), profil: donnees.profil,
  };
  magasin.comptes.push(compte);
  return compte;
}
/** Champs du profil que le client peut éditer lui-même (menu Profil) ; tout le reste (nom,
 *  naissance, KYC…) passe par l'administration. Valeurs chaînes bornées, rien d'autre. */
export const CHAMPS_PROFIL_EDITABLES = [
  "rue", "numero", "boite", "codePostal", "ville", "pays", "telephone",
  "employeur", "profession", "anciennete", "entreprise", "tva", "secteur",
  "revenusNets", "chargeLogement", "iban", "creditsExistants",
] as const;
export function mettreAJourProfilServeur(
  magasin: Magasin, session: SessionServeur, patch: Record<string, unknown>,
): Record<string, string> | null {
  const compte = trouverCompte(magasin, session.email, session.role);
  if (!compte) return null;
  const profil = { ...(compte.profil ?? {}) };
  for (const champ of CHAMPS_PROFIL_EDITABLES) {
    const v = patch[champ];
    if (typeof v === "string") profil[champ] = v.slice(0, 200);
  }
  compte.profil = profil;
  return profil;
}
export function changerMotDePasse(magasin: Magasin, email: string, role: RoleServeur, actuel: string, neuf: string): boolean {
  const compte = trouverCompte(magasin, email, role);
  if (!compte || neuf.length < 8) return false;
  if (!verifierMotDePasse(actuel, compte.sel, compte.hash)) return false;
  compte.sel = nouveauSel();
  compte.hash = hacherMotDePasse(neuf, compte.sel);
  return true;
}

/* ——— Sessions (jetons côté serveur, expiration) ——— */
export function ouvrirSessionServeur(magasin: Magasin, compte: CompteServeur, maintenant: Date = new Date()): SessionServeur {
  const expireA = new Date(maintenant.getTime() + DUREE_SESSION_JOURS * 24 * 3600 * 1000);
  const session: SessionServeur = {
    jeton: randomBytes(32).toString("hex"),
    email: compte.email, role: compte.role, nom: compte.nom,
    ouverteA: maintenant.toISOString(), expireA: expireA.toISOString(),
  };
  magasin.sessions.push(session);
  return session;
}
export function verifierSession(magasin: Magasin, jeton: string | undefined | null, maintenant: Date = new Date()): SessionServeur | null {
  if (!jeton) return null;
  const s = magasin.sessions.find((x) => x.jeton === jeton) ?? null;
  if (!s) return null;
  if (new Date(s.expireA).getTime() <= maintenant.getTime()) return null;
  return s;
}
export function revoquerSession(magasin: Magasin, jeton: string | undefined | null): boolean {
  if (!jeton) return false;
  const avant = magasin.sessions.length;
  magasin.sessions = magasin.sessions.filter((s) => s.jeton !== jeton);
  return magasin.sessions.length < avant;
}

/* ——— Options du cookie de session (posées par les Route Handlers) ——— */
/** En production l'aperçu vit dans une iframe cross-site (preview Arena) : un cookie `Lax` n'y
 *  est JAMAIS renvoyé par le navigateur → déconnexion immédiate après connexion. On passe donc à
 *  `SameSite=None; Secure` en production (HTTPS) ; le dev local reste en `Lax`. */
export function optionsCookie(production: boolean) {
  return {
    httpOnly: true, sameSite: (production ? "none" : "lax") as "none" | "lax", path: "/",
    secure: production, maxAge: DUREE_SESSION_JOURS * 24 * 3600,
  };
}

/* ——— La table canonique, telle que le serveur la lit (miroir du frontend) ——— */
export function grillePourApi() {
  const ouverte = HISTORIQUE_GRILLES.find((e) => e.effectif_au === null) ?? HISTORIQUE_GRILLES[HISTORIQUE_GRILLES.length - 1];
  let precedente: (typeof HISTORIQUE_GRILLES)[number] | null = null;
  const historique = HISTORIQUE_GRILLES.map((e) => {
    const ligne = {
      version: e.version, effectif_du: e.effectif_du, effectif_au: e.effectif_au,
      hash: e.hash, hash_precedent: e.hash_precedent, chainon_valide: chainonValide(e, precedente),
      regles: reglesDeEntree(e, GRILLE.pays).length,
    };
    precedente = e;
    return ligne;
  });
  return {
    schema: GRILLE.schema, pays: GRILLE.pays, devise: GRILLE.devise,
    version: GRILLE_VERSION, effectif_depuis: ouverte.effectif_du,
    historique,
    regles_effectives: reglesDeEntree(ouverte, GRILLE.pays).map((r) => ({
      id: r.id, minAmount: r.minAmount, maxAmount: r.maxAmount, baseRate: r.baseRate,
    })),
  };
}

export function sondeGrillePourApi(dateISO: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return null;
  const entree = grilleValideA(`${dateISO}T12:00:00Z`);
  return { date: dateISO, version: entree.version, effectif_du: entree.effectif_du, effectif_au: entree.effectif_au };
}

export function simulerServeur(input: SimulateInput) {
  return simulateCredit(input);
}

/** Empreinte d'un jeton pour les journaux (jamais le jeton complet). */
export function empreinteJeton(jeton: string): string {
  return createHash("sha256").update(jeton).digest("hex").slice(0, 12);
}
