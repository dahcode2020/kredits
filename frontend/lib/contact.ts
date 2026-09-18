import type { Locale } from "@/lib/i18n";

/**
 * Le contact, côté isomorphe — importable du navigateur ET du serveur.
 *
 * Pourquoi ce module existe : `lib/serveur.ts` (le domaine du magasin) importe node:crypto et
 * node:fs — il ne peut jamais être importé par un composant client. Or le formulaire de contact
 * (navigateur) et l'API (serveur) ont besoin des MÊMES bornes et de la MÊME table erreur → clé
 * i18n. « Une valeur = une table = un endroit » exige qu'elles vivent ici, et que `lib/serveur.ts`
 * se contente de les ré-exporter.
 */

export type StatutMessageContact = "NOUVEAU" | "TRAITE";
export interface MessageContact {
  id: string; nom: string; email: string; sujet: string; message: string;
  locale: Locale; creeA: string; statut: StatutMessageContact;
  traiteA?: string; traitePar?: string;
}

/** Bornes du formulaire — le serveur tranche, le client ne fait qu'annoncer (maxLength). */
export const CONTACT_NOM_MAX = 120;
export const CONTACT_SUJET_MAX = 160;
export const CONTACT_MESSAGE_MAX = 4_000;
export const CONTACT_MESSAGE_MIN = 10;

/** Codes d'erreur du dépôt → clés de dictionnaire. Table explicite et CLÉS STATIQUES : jamais
 *  `t(locale, \`contact.err.${code}\`)` — une clé construite échappe au scan de parité
 *  (tests/unit/i18n-keys-usage.spec.ts) et réapparaîtrait en français sur /en, /nl, /de. */
export const CLES_ERREUR_CONTACT: Record<string, string> = {
  nom_invalide: "contact.err.nom",
  email_invalide: "contact.err.email",
  sujet_invalide: "contact.err.sujet",
  message_invalide: "contact.err.message",
  consentement_requis: "contact.err.consentement",
  champs_invalides: "contact.err.champs",
};
