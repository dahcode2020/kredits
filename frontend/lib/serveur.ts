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
  GRILLE, GRILLE_VERSION, HISTORIQUE_GRILLES, chainonValide, grilleValideA, reglesDeEntree,
  simulateCredit, type SimulateInput,
} from "@/lib/credit-engine";

import { COMPTES_PORTE_DEMO, type RoleServeur } from "@/lib/serveur-demo";
import type { BanqueCompte, MessageChat, SurchargesReferentiel } from "@/lib/banque";
export type { RoleServeur };
export { COMPTES_PORTE_DEMO };

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
}

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
  if (!magasin.comptes.some((c) => c.role !== "CUSTOMER")) semerPersonnel(magasin);
  return magasin;
}
export function ecrireMagasin(magasin: Magasin, dossier: string = dossierDonnees()): void {
  mkdirSync(dossier, { recursive: true });
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
