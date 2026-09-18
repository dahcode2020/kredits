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
import { locales, t, tSiCle, type Locale } from "@/lib/i18n";
// L'e-mail ne se valide qu'une seule fois dans le dépôt (lib/auth.ts) : le formulaire de contact
// du serveur utilise le même prédicat que l'inscription, pas une seconde expression.
import { emailValide } from "@/lib/auth";
// L'annuité du crédit vit UNE SEULE FOIS dans le module isomorphe `contrat-doc` (importable
// côté navigateur pour l'aperçu/annexe) ; ce module Node la ré-exporte pour ses appels internes
// et pour les verrous qui l'importent historiquement d'ici.
import { mensualiteContrat, langueContratValide, type LangueContrat, CONTRAT_CORPS_MAX, CONTRAT_PRETEUR_MAX, CONTRAT_REFERENCE_MAX, CONTRAT_LOGO_MAX, LOGO_DATAURL_RE } from "@/lib/contrat-doc";
export { mensualiteContrat } from "@/lib/contrat-doc";
import {
  configNotifDepuisEnv, envoyerEmailResend, envoyerWhatsAppMeta, numeroInternational,
  type ConfigNotif, type FetchImpl, type StatutEnvoi,
} from "@/lib/notifier";
export type { ConfigNotif, FetchImpl, RoleServeur, StatutEnvoi };
export { COMPTES_PORTE_DEMO, configNotifDepuisEnv, numeroInternational };

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
 *  texte en dur. `canaux` raconte honnêtement la distribution réelle (site + e-mail + WhatsApp) :
 *  rien n'est « envoyé » en silence. */
export interface NotificationServeur {
  id: string; email: string; cle: string; vars?: Record<string, string>; creeA: string;
  canaux?: { email?: StatutEnvoi; whatsapp?: StatutEnvoi };
}

/** Préférences de distribution réelle du client (source de vérité : le serveur). */
export interface PrefsNotifServeur { email: boolean; whatsapp: boolean }

/* ——— Messages de contact : le domaine vit ici (magasin, dépôt, transitions), les types, bornes
 *  et la table erreur→clé i18n vivent dans lib/contact.ts (isomorphe) et sont ré-exportés. ——— */
import {
  CLES_ERREUR_CONTACT, CONTACT_MESSAGE_MAX, CONTACT_MESSAGE_MIN, CONTACT_NOM_MAX, CONTACT_SUJET_MAX,
  type MessageContact,
} from "@/lib/contact";
export {
  CLES_ERREUR_CONTACT, CONTACT_MESSAGE_MAX, CONTACT_MESSAGE_MIN, CONTACT_NOM_MAX, CONTACT_SUJET_MAX,
} from "@/lib/contact";
export type { MessageContact, StatutMessageContact } from "@/lib/contact";

/** Contrat de crédit établi par l'administration pour un client (menu Contrats, slice 23) :
 *  conditions + mentions libres, aperçu et téléchargement, puis notification au client par
 *  e-mail / WhatsApp. BROUILLON tant qu'il n'a pas été notifié ; la mensualité est TOUJOURS
 *  recalculée par le serveur (jamais saisie à la main). */
export type StatutContrat = "BROUILLON" | "NOTIFIE";
export interface ContratServeur {
  id: string; email: string; demandeId?: string; objet: string;
  montant: number; dureeMois: number; tauxAnnuel: number; mensualite: number;
  mentions: string[];
  /** Référence au format du prêteur (« 006689TE/CI/0035 »), générée à la création, éditable. */
  reference: string;
  /** Corps du « LOAN AGREEMENT » (texte éditable, placeholders {{…}} remplis au rendu) ;
   *  absent = modèle par défaut `CORPS_CONTRAT_DEFAUT`. */
  corps?: string;
  /** Bloc « THE LENDER » éditable ; absent = `PRETEUR_DEFAUT`. */
  preteur?: string;
  /** Logo de l'entête en dataURL (png/jpeg/webp) ; absent = logo par défaut `/logos/tei.png`. */
  logo?: string;
  /** Langue du document : EN (modèle fourni) ou FR ; absent = EN. Deux langues, pas davantage. */
  langue?: LangueContrat;
  statut: StatutContrat; creeA: string; majA: string; notifieA?: string;
}

export type ErreurContenuContrat = "corps_invalide" | "preteur_invalide" | "logo_invalide" | "reference_invalide" | "langue_invalide";

/** `null` = « revenir au défaut » (modèle, prêteur, logo, référence régénérée). */
function contenuContratValide(c: { corps?: unknown; preteur?: unknown; logo?: unknown; reference?: unknown; langue?: unknown }): ErreurContenuContrat | null {
  if (c.langue !== undefined && c.langue !== null && !langueContratValide(c.langue)) return "langue_invalide";
  if (c.corps !== undefined && c.corps !== null && (typeof c.corps !== "string" || c.corps.length > CONTRAT_CORPS_MAX)) return "corps_invalide";
  if (c.preteur !== undefined && c.preteur !== null && (typeof c.preteur !== "string" || c.preteur.length > CONTRAT_PRETEUR_MAX)) return "preteur_invalide";
  if (c.logo !== undefined && c.logo !== null && (typeof c.logo !== "string" || c.logo.length > CONTRAT_LOGO_MAX || !LOGO_DATAURL_RE.test(c.logo))) return "logo_invalide";
  if (c.reference !== undefined && c.reference !== null && (typeof c.reference !== "string" || c.reference.trim().length === 0 || c.reference.trim().length > CONTRAT_REFERENCE_MAX)) return "reference_invalide";
  return null;
}

/** Référence auto au format du prêteur : séquence 6 chiffres + « TE/CI/ » + numéro 4 chiffres. */
export function referenceContrat(magasin: Magasin): string {
  const n = (magasin.contrats ?? []).length + 1;
  return `${String(6688 + n).padStart(6, "0")}TE/CI/${String(34 + n).padStart(4, "0")}`;
}
/** Taille maximale d'un document téléversé (dataURL comprise) — même plafond que la photo. */
export const DOCUMENT_MAX_OCTETS = 5 * 1024 * 1024;

export interface CompteServeur {
  email: string; role: RoleServeur; nom: string; creeA: string;
  sel: string; hash: string; profil?: Record<string, string>;
  prefsNotif?: PrefsNotifServeur;
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
  contrats?: ContratServeur[];
  notifications?: NotificationServeur[];
  messages?: MessageContact[];
  /** Version du format de données : un magasin d'une autre version est re-semé, jamais migré à
   *  l'aveugle — aucun vieux fichier ne peut produire des comportements fantômes après un déploiement. */
  versionMagasin?: number;
}

/** À incrémenter à chaque changement de forme des données du magasin. */
export const VERSION_MAGASIN = 9;

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
  if (!magasin.contrats) semerContratsDemo(magasin);
  if (!magasin.messages) semerMessagesDemo(magasin);
  if (!magasin.comptes.find((c) => c.email === COMPTES_PORTE_DEMO[0].email)?.prefsNotif) {
    const demo = magasin.comptes.find((c) => c.email === COMPTES_PORTE_DEMO[0].email);
    if (demo) demo.prefsNotif = { email: true, whatsapp: true };
  }
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
      canaux: { email: "non_configure", whatsapp: "non_configure" },
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
/** L'administration approuve une pièce soumise (transition pure) ; la NOTIFICATION au client
 *  est émise par `notifierClient` dans la route — site + e-mail + WhatsApp en un seul geste. */
export function approuverDocument(
  magasin: Magasin, documentId: string, par: string, maintenant: string,
): { document?: DocumentServeur; erreur?: "introuvable" | "etat_inchange" } {
  const doc = (magasin.documents ?? []).find((x) => x.id === documentId);
  if (!doc) return { erreur: "introuvable" };
  if (doc.statut === "APPROUVE") return { erreur: "etat_inchange" };
  doc.statut = "APPROUVE"; doc.approuveA = maintenant; doc.approuvePar = par;
  return { document: doc };
}

/* ——— Centre de notification : site + e-mail (Resend) + WhatsApp (API Cloud Meta), GRATUITS ——— */
let compteurNotification = 0;
export function idNotification(maintenant: string, existants: string[]): string {
  for (;;) {
    compteurNotification += 1;
    const id = `NOTIF-${maintenant.slice(0, 10).replace(/-/g, "")}-${Math.floor(Math.random() * 46_656).toString(36).toUpperCase().padStart(3, "0")}${(compteurNotification % 36).toString(36).toUpperCase()}`;
    if (!existants.includes(id)) return id;
  }
}
/** Notification sur site (toujours créée) — les canaux e-mail/WhatsApp s'y ajoutent. */
export function deposerNotification(
  magasin: Magasin, n: { email: string; cle: string; vars?: Record<string, string>; maintenant: string },
): NotificationServeur {
  const notif: NotificationServeur = {
    id: idNotification(n.maintenant, (magasin.notifications ?? []).map((x) => x.id)),
    email: n.email.trim().toLowerCase(), cle: n.cle, vars: n.vars, creeA: n.maintenant,
  };
  magasin.notifications = [...(magasin.notifications ?? []), notif];
  return notif;
}
export function mettreAJourPrefsNotif(magasin: Magasin, session: SessionServeur, patch: Record<string, unknown>): PrefsNotifServeur | null {
  const compte = trouverCompte(magasin, session.email, session.role);
  if (!compte) return null;
  const actuelles: PrefsNotifServeur = compte.prefsNotif ?? { email: true, whatsapp: false };
  compte.prefsNotif = {
    email: typeof patch.email === "boolean" ? patch.email : actuelles.email,
    whatsapp: typeof patch.whatsapp === "boolean" ? patch.whatsapp : actuelles.whatsapp,
  };
  return compte.prefsNotif;
}
/** Le geste complet : notification sur site PUIS distribution réelle selon les préférences du
 *  client et la configuration des fournisseurs (e-mail du compte, numéro du profil). Les statuts
 *  d'envoi sont enregistrés sur la notification — l'UI les montre, rien n'est simulé. */
export async function notifierClient(
  magasin: Magasin,
  evt: { email: string; cle: string; vars?: Record<string, string>; maintenant: string },
  options?: { config?: ConfigNotif; fetchImpl?: FetchImpl; locale?: Locale },
): Promise<NotificationServeur> {
  const notif = deposerNotification(magasin, evt);
  const compte = magasin.comptes.find((c) => c.email === notif.email);
  const prefs: PrefsNotifServeur = compte?.prefsNotif ?? { email: true, whatsapp: false };
  const config = options?.config ?? configNotifDepuisEnv(process.env as Record<string, string | undefined>);
  const fetchImpl = options?.fetchImpl ?? (fetch as unknown as FetchImpl);
  const locale: Locale = options?.locale ?? "fr";
  // Texte concret pour l'e-mail / WhatsApp : les variables-clés (ex. « credit:documents.ID »)
  // sont résolues, le reste passe tel quel. Le sujet = le message (une seule ligne).
  const varsResolues: Record<string, string> = {};
  for (const [k, v] of Object.entries(evt.vars ?? {})) varsResolues[k] = tSiCle(locale, v);
  const texte = t(locale, evt.cle, varsResolues);
  notif.canaux = {};
  notif.canaux.email = prefs.email
    ? await envoyerEmailResend(config.resend, notif.email, `KREDIT — ${texte}`, texte, fetchImpl)
    : "desactive";
  const numero = compte?.profil?.telephone ? numeroInternational(compte.profil.telephone) : null;
  notif.canaux.whatsapp = prefs.whatsapp
    ? (numero ? await envoyerWhatsAppMeta(config.whatsapp, numero, texte, fetchImpl) : "echec")
    : "desactive";
  return notif;
}
/** Le même geste pour l'équipe (ADMIN / SUPER_ADMIN) : quand un client répond dans le chat,
 *  chaque membre du personnel reçoit une notification sur site + un e-mail réel si le
 *  fournisseur est configuré. Pas de WhatsApp : le personnel n'a pas de numéro au dossier. */
export async function notifierStaff(
  magasin: Magasin,
  evt: { cle: string; vars?: Record<string, string>; maintenant: string },
  options?: { config?: ConfigNotif; fetchImpl?: FetchImpl; locale?: Locale },
): Promise<NotificationServeur[]> {
  const staff = magasin.comptes.filter((c) => c.role !== "CUSTOMER");
  if (staff.length === 0) return [];
  const config = options?.config ?? configNotifDepuisEnv(process.env as Record<string, string | undefined>);
  const fetchImpl = options?.fetchImpl ?? (fetch as unknown as FetchImpl);
  const locale: Locale = options?.locale ?? "fr";
  const varsResolues: Record<string, string> = {};
  for (const [k, v] of Object.entries(evt.vars ?? {})) varsResolues[k] = tSiCle(locale, v);
  const texte = t(locale, evt.cle, varsResolues);
  const notifs: NotificationServeur[] = [];
  for (const membre of staff) {
    const notif = deposerNotification(magasin, { email: membre.email, cle: evt.cle, vars: evt.vars, maintenant: evt.maintenant });
    notif.canaux = { email: await envoyerEmailResend(config.resend, membre.email, `KREDIT — ${texte}`, texte, fetchImpl) };
    notifs.push(notif);
  }
  return notifs;
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

/* ——— Contrats : établis par l'administration, notifiés au client (slice 23) ——— */
/** Contrat de démonstration du client vitrine : les conditions de la demande PERSONAL,
 *  mensualité calculée par LE moteur (jamais un montant écrit à la main), une mention semée. */
function semerContratsDemo(magasin: Magasin): void {
  const demande = (magasin.demandes ?? []).find((d) => d.id === "KRD-2026-DEMOA1");
  if (!demande) { magasin.contrats = []; return; }
  const sim = simulateCredit({
    amount: demande.etat.amount, termMonths: demande.etat.term, monthlyIncome: demande.etat.income,
    monthlyCharges: demande.etat.charges, incomeType: demande.etat.incomeType,
    employmentStatus: demande.etat.employment, loanPurpose: demande.etat.purpose,
    existingCreditsMonthly: demande.etat.existing, country: "BE", productType: demande.etat.product,
  });
  // La grille stocke le taux en FRACTION (0.025 = 2,5 %), le contrat en POURCENTAGE (2.5) :
  // conversion pour que mensualité et affichage restent fidèles à la simulation.
  const tauxPct = Math.round(sim.simulation.annualRate * 10000) / 100;
  magasin.contrats = [{
    id: "CTR-2026-DEMOA1", email: "client@kredit.be", demandeId: demande.id,
    objet: "dashboard.contracts.seed.objet",
    montant: demande.etat.amount, dureeMois: demande.etat.term,
    tauxAnnuel: tauxPct,
    mensualite: mensualiteContrat(demande.etat.amount, demande.etat.term, tauxPct),
    mentions: ["dashboard.contracts.seed.mention"],
    reference: "006689TE/CI/0035",
    statut: "BROUILLON", creeA: "2026-09-13T10:00:00.000Z", majA: "2026-09-13T10:00:00.000Z",
  }];
}

/** Message de contact de démonstration : un seul, NON traité, pour que le menu Messages de
 *  l'administration montre un cas réel dès la première ouverture (même philosophie que les
 *  demandes, paiements et documents semés). Son sujet et son corps sont des CLÉS i18n — jamais
 *  de la copie en dur dans le serveur. */
function semerMessagesDemo(magasin: Magasin): void {
  magasin.messages = [{
    id: "MSG-2026-DEMOA1", nom: "Client KREDIT", email: "client@kredit.be",
    sujet: "contact.demoSubject", message: "contact.demoMessage",
    locale: "fr", creeA: "2026-09-16T08:12:00.000Z", statut: "NOUVEAU",
  }];
}

let compteurMessage = 0;
export function idMessageContact(maintenant: string, existants: string[]): string {
  for (;;) {
    compteurMessage += 1;
    const id = `MSG-${maintenant.slice(0, 10).replace(/-/g, "")}-${Math.floor(Math.random() * 46_656).toString(36).toUpperCase().padStart(3, "0")}${(compteurMessage % 36).toString(36).toUpperCase()}`;
    if (!existants.includes(id)) return id;
  }
}
/** Dépôt d'un message de contact (formulaire public). Tout est borné et tranché ici : un
 *  visiteur ne peut pas écrire un nom de 10 000 caractères ni un message vide. */
export function deposerMessageContact(
  magasin: Magasin,
  m: { nom: string; email: string; sujet: string; message: string; consentement: unknown; locale?: string; maintenant: string },
): { message?: MessageContact; erreur?: "nom_invalide" | "email_invalide" | "sujet_invalide" | "message_invalide" | "consentement_requis" } {
  const nom = String(m.nom ?? "").trim();
  const email = String(m.email ?? "").trim().toLowerCase();
  const sujet = String(m.sujet ?? "").trim();
  const message = String(m.message ?? "").trim();
  if (nom.length < 2 || nom.length > CONTACT_NOM_MAX) return { erreur: "nom_invalide" };
  if (!emailValide(email)) return { erreur: "email_invalide" };
  if (sujet.length < 2 || sujet.length > CONTACT_SUJET_MAX) return { erreur: "sujet_invalide" };
  if (message.length < CONTACT_MESSAGE_MIN || message.length > CONTACT_MESSAGE_MAX) return { erreur: "message_invalide" };
  // Sans consentement, pas de dépôt : c'est la seule base légale du traitement (RGPD).
  if (m.consentement !== true) return { erreur: "consentement_requis" };
  const locale: Locale = (locales as readonly string[]).includes(String(m.locale)) ? (m.locale as Locale) : "fr";
  const msg: MessageContact = {
    id: idMessageContact(m.maintenant, (magasin.messages ?? []).map((x) => x.id)),
    nom, email, sujet, message, locale, creeA: m.maintenant, statut: "NOUVEAU",
  };
  magasin.messages = [...(magasin.messages ?? []), msg];
  return { message: msg };
}
/** Liste de l'administration : le plus récent d'abord (ce sont les messages à traiter). */
export function messagesContact(magasin: Magasin): MessageContact[] {
  return [...(magasin.messages ?? [])].sort((a, b) => b.creeA.localeCompare(a.creeA));
}
/** Un membre du personnel prend le message en charge : transition pure, la notification au
 *  client est émise par la route (site + e-mail réel si le fournisseur est configuré). */
export function traiterMessageContact(
  magasin: Magasin, id: string, par: string, maintenant: string,
): { message?: MessageContact; erreur?: "introuvable" | "etat_inchange" } {
  const msg = (magasin.messages ?? []).find((x) => x.id === id);
  if (!msg) return { erreur: "introuvable" };
  if (msg.statut === "TRAITE") return { erreur: "etat_inchange" };
  msg.statut = "TRAITE"; msg.traiteA = maintenant; msg.traitePar = par;
  return { message: msg };
}

let compteurContrat = 0;
export function idContrat(maintenant: string, existants: string[]): string {
  for (;;) {
    compteurContrat += 1;
    const id = `CTR-${maintenant.slice(0, 10).replace(/-/g, "")}-${Math.floor(Math.random() * 46_656).toString(36).toUpperCase().padStart(3, "0")}${(compteurContrat % 36).toString(36).toUpperCase()}`;
    if (!existants.includes(id)) return id;
  }
}
export function contratsPour(magasin: Magasin, email: string): ContratServeur[] {
  const e = email.trim().toLowerCase();
  return (magasin.contrats ?? []).filter((c) => c.email === e);
}
function mentionsValides(brutes: unknown): string[] | null {
  if (!Array.isArray(brutes)) return [];
  if (brutes.length > 12) return null;
  const propres: string[] = [];
  for (const m of brutes) {
    if (typeof m !== "string") return null;
    const t = m.trim();
    if (t.length > 300) return null;
    if (t) propres.push(t);
  }
  return propres;
}
/** L'administration établit un contrat pour un client. La mensualité est calculée ici. */
export function creerContrat(
  magasin: Magasin,
  d: { email: string; objet: string; montant: number; dureeMois: number; tauxAnnuel: number; mentions?: unknown; demandeId?: string; maintenant: string; corps?: unknown; preteur?: unknown; logo?: unknown; reference?: unknown; langue?: unknown },
): { contrat?: ContratServeur; erreur?: "compte_introuvable" | "montant_invalide" | "duree_invalide" | "taux_invalide" | "objet_invalide" | "mentions_invalides" | ErreurContenuContrat } {
  const email = d.email.trim().toLowerCase();
  if (!magasin.comptes.some((c) => c.email === email && c.role === "CUSTOMER")) return { erreur: "compte_introuvable" };
  if (!Number.isFinite(d.montant) || d.montant <= 0 || d.montant > 10_000_000) return { erreur: "montant_invalide" };
  if (!Number.isInteger(d.dureeMois) || d.dureeMois < 1 || d.dureeMois > 600) return { erreur: "duree_invalide" };
  if (!Number.isFinite(d.tauxAnnuel) || d.tauxAnnuel < 0 || d.tauxAnnuel > 30) return { erreur: "taux_invalide" };
  const objet = d.objet.trim();
  if (!objet || objet.length > 160) return { erreur: "objet_invalide" };
  const mentions = mentionsValides(d.mentions ?? []);
  if (mentions === null) return { erreur: "mentions_invalides" };
  const contenu = contenuContratValide(d);
  if (contenu) return { erreur: contenu };
  const contrat: ContratServeur = {
    id: idContrat(d.maintenant, (magasin.contrats ?? []).map((c) => c.id)),
    email, demandeId: d.demandeId?.trim() || undefined, objet: objet.slice(0, 160),
    montant: Math.round(d.montant * 100) / 100, dureeMois: d.dureeMois,
    tauxAnnuel: Math.round(d.tauxAnnuel * 100) / 100,
    mensualite: mensualiteContrat(d.montant, d.dureeMois, d.tauxAnnuel),
    mentions,
    reference: typeof d.reference === "string" && d.reference.trim() ? d.reference.trim().slice(0, CONTRAT_REFERENCE_MAX) : referenceContrat(magasin),
    corps: typeof d.corps === "string" && d.corps.trim() ? d.corps : undefined,
    preteur: typeof d.preteur === "string" && d.preteur.trim() ? d.preteur.trim() : undefined,
    logo: typeof d.logo === "string" ? d.logo : undefined,
    langue: langueContratValide(d.langue) ? d.langue : undefined,
    statut: "BROUILLON", creeA: d.maintenant, majA: d.maintenant,
  };
  magasin.contrats = [...(magasin.contrats ?? []), contrat];
  return { contrat };
}
/** Mise à jour d'un contrat (objet, conditions, mentions) : la mensualité est recalculée,
 *  `majA` bouge. Les champs absents du patch sont conservés tels quels. */
export function majContrat(
  magasin: Magasin, contratId: string, maintenant: string,
  patch: { objet?: unknown; montant?: unknown; dureeMois?: unknown; tauxAnnuel?: unknown; mentions?: unknown; corps?: unknown; preteur?: unknown; logo?: unknown; reference?: unknown; langue?: unknown },
): { contrat?: ContratServeur; erreur?: "introuvable" | "montant_invalide" | "duree_invalide" | "taux_invalide" | "objet_invalide" | "mentions_invalides" | ErreurContenuContrat } {
  const contrat = (magasin.contrats ?? []).find((c) => c.id === contratId);
  if (!contrat) return { erreur: "introuvable" };
  const contenu = contenuContratValide(patch);
  if (contenu) return { erreur: contenu };
  let { objet, montant, dureeMois, tauxAnnuel } = contrat;
  if (patch.objet !== undefined) {
    if (typeof patch.objet !== "string" || !patch.objet.trim() || patch.objet.trim().length > 160) return { erreur: "objet_invalide" };
    objet = patch.objet.trim().slice(0, 160);
  }
  if (patch.montant !== undefined) {
    const m = Number(patch.montant);
    if (!Number.isFinite(m) || m <= 0 || m > 10_000_000) return { erreur: "montant_invalide" };
    montant = Math.round(m * 100) / 100;
  }
  if (patch.dureeMois !== undefined) {
    const n = Number(patch.dureeMois);
    if (!Number.isInteger(n) || n < 1 || n > 600) return { erreur: "duree_invalide" };
    dureeMois = n;
  }
  if (patch.tauxAnnuel !== undefined) {
    const t = Number(patch.tauxAnnuel);
    if (!Number.isFinite(t) || t < 0 || t > 30) return { erreur: "taux_invalide" };
    tauxAnnuel = Math.round(t * 100) / 100;
  }
  let mentions = contrat.mentions;
  if (patch.mentions !== undefined) {
    const propres = mentionsValides(patch.mentions);
    if (propres === null) return { erreur: "mentions_invalides" };
    mentions = propres;
  }
  contrat.objet = objet; contrat.montant = montant; contrat.dureeMois = dureeMois;
  contrat.tauxAnnuel = tauxAnnuel; contrat.mentions = mentions;
  // Contenu éditable du document : champ absent conservé, `null` = retour au défaut.
  if (patch.corps !== undefined) contrat.corps = typeof patch.corps === "string" && patch.corps.trim() ? patch.corps : undefined;
  if (patch.preteur !== undefined) contrat.preteur = typeof patch.preteur === "string" && patch.preteur.trim() ? patch.preteur.trim() : undefined;
  if (patch.logo !== undefined) contrat.logo = typeof patch.logo === "string" ? patch.logo : undefined;
  if (patch.reference !== undefined) contrat.reference = typeof patch.reference === "string" && patch.reference.trim() ? patch.reference.trim().slice(0, CONTRAT_REFERENCE_MAX) : referenceContrat(magasin);
  if (patch.langue !== undefined) contrat.langue = langueContratValide(patch.langue) ? patch.langue : undefined;
  contrat.mensualite = mensualiteContrat(montant, dureeMois, tauxAnnuel);
  contrat.majA = maintenant;
  return { contrat };
}
/** Transition pure : le contrat passe NOTIFIE (l'envoi réel e-mail/WhatsApp est fait par la
 *  route via `notifierClient`). */
export function notifierContrat(magasin: Magasin, contratId: string, maintenant: string): { contrat?: ContratServeur; erreur?: "introuvable" } {
  const contrat = (magasin.contrats ?? []).find((c) => c.id === contratId);
  if (!contrat) return { erreur: "introuvable" };
  contrat.statut = "NOTIFIE"; contrat.notifieA = maintenant;
  return { contrat };
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
