/**
 * Portail local (slice 4) — démonstration SANS backend, et l'UI le dit partout.
 *
 * - les comptes et la session vivent dans localStorage (jamais au render : lus/écrits dans les
 *   handlers et effects, contrat d'hydratation) ;
 * - le mot de passe n'est JAMAIS stocké en clair : empreinte SHA-256 (WebCrypto) calculée au
 *   dépôt et à la connexion — côté navigateur, donc une démo pédagogique, pas un coffre ;
 * - trois profils sur la même page d'authentification (CUSTOMER s'inscrit ou se connecte ;
 *   ADMIN / SUPER_ADMIN se connectent — leurs comptes sont « fournis par l'organisation », en
 *   démo via les boutons explicites) ;
 * - pur autant que possible : `emailValide` et `ageEnAnnees` sont testés en Node.
 */
export type Role = "CUSTOMER" | "ADMIN" | "SUPER_ADMIN";
export const ROLES: readonly Role[] = ["CUSTOMER", "ADMIN", "SUPER_ADMIN"];

export const CLE_SESSION = "kredit.session.v1";
export const CLE_COMPTES = "kredit.comptes.v1";

export interface Session {
  email: string;
  role: Role;
  nom: string;
  ouverteA: string;
}

export interface ProfilInscription {
  nom: string;
  prenom: string;
  naissance: string;
  nationalite: string;
  marital: string;
  rue: string;
  numero: string;
  boite: string;
  codePostal: string;
  ville: string;
  pays: string;
  telephone: string;
  employeur: string;
  profession: string;
  anciennete: string;
  entreprise: string;
  tva: string;
  secteur: string;
  revenusNets: string;
  logement: string;
  chargeLogement: string;
  iban: string;
  creditsExistants: string;
}

export interface Compte {
  email: string;
  hash: string;
  role: Role;
  nom: string;
  creeA: string;
  profil?: ProfilInscription;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function emailValide(s: string): boolean {
  return EMAIL_RE.test(s.trim());
}

/** Âge révolu en années — la majorité (18) est exigée à l'inscription. */
export function ageEnAnnees(naissance: string, maintenant: Date): number {
  const n = new Date(`${naissance}T00:00:00Z`);
  if (Number.isNaN(n.getTime())) return -1;
  let a = maintenant.getUTCFullYear() - n.getUTCFullYear();
  const m = maintenant.getUTCMonth() - n.getUTCMonth();
  if (m < 0 || (m === 0 && maintenant.getUTCDate() < n.getUTCDate())) a--;
  return a;
}

export async function hacher(motDePasse: string): Promise<string> {
  const donnees = new TextEncoder().encode(`kredit::${motDePasse}`);
  const digest = await crypto.subtle.digest("SHA-256", donnees);
  return [...new Uint8Array(digest)].map((o) => o.toString(16).padStart(2, "0")).join("");
}

function lire<T>(cle: string): T[] {
  try {
    const brut = window.localStorage.getItem(cle);
    const liste = brut ? JSON.parse(brut) : [];
    return Array.isArray(liste) ? (liste as T[]) : [];
  } catch {
    return [];
  }
}

export function lireComptes(): Compte[] {
  return lire<Compte>(CLE_COMPTES);
}

export function enregistrerCompte(compte: Compte): void {
  try {
    window.localStorage.setItem(CLE_COMPTES, JSON.stringify([...lireComptes(), compte]));
  } catch {
    // stockage indisponible (navigation privée) : la session en mémoire suffit pour la démo.
  }
}

export function comptePour(email: string, role: Role): Compte | null {
  const e = email.trim().toLowerCase();
  return lireComptes().find((c) => c.email.toLowerCase() === e && c.role === role) ?? null;
}

/** Remplace un compte (ex. changement de mot de passe) — même email+role. */
export function mettreAJourCompte(email: string, role: Role, patch: Partial<Compte>): void {
  const e = email.trim().toLowerCase();
  const liste = lireComptes().map((c) =>
    c.email.toLowerCase() === e && c.role === role ? { ...c, ...patch } : c,
  );
  try {
    window.localStorage.setItem(CLE_COMPTES, JSON.stringify(liste));
  } catch {
    // idem.
  }
}

export function lireSession(): Session | null {
  try {
    const brut = window.localStorage.getItem(CLE_SESSION);
    return brut ? (JSON.parse(brut) as Session) : null;
  } catch {
    return null;
  }
}

export function ouvrirSession(s: Session): void {
  try {
    window.localStorage.setItem(CLE_SESSION, JSON.stringify(s));
  } catch {
    // idem : la démo continue en mémoire.
  }
}

export function fermerSession(): void {
  try {
    window.localStorage.removeItem(CLE_SESSION);
  } catch {
    // rien à faire.
  }
}
