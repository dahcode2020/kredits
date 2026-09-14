/**
 * Slice 11 — la banque côté serveur : le localStorage prend sa retraite.
 *
 * Principe : l'UI n'applique JAMAIS les transitions d'état — elle envoie des intentions, le
 * serveur applique la machine à états pure de lib/banque.ts (la même que la démo locale utilisait)
 * et renvoie le nouvel état. Personne ne peut forger un solde ou sauter un niveau de validation.
 *
 * Autorisations : CUSTOMER n'agit que sur son propre compte (virement, annulation, chat, photo) ;
 * ADMIN / SUPER_ADMIN agissent sur tous les comptes (crédit, vérification, pipeline, référentiel,
 * chat support). Tout passe par la session httpOnly (voir lib/serveur.ts).
 */
import { NOM_COOKIE, verifierSession, type Magasin, type SessionServeur } from "@/lib/serveur";
import { COMPTES_PORTE_DEMO, banqueDemoIllustrative } from "@/lib/serveur-demo";
import {
  annulerVirement, bicValide, bloquerVirement, cleBanque, confirmerNiveau, denouer, initierVirement,
  leverBlocage, ouvrirBanqueClient, referentielEffectif, refuserVirement,
  type BanqueCompte, type MessageChat, type Referentiel, type SurchargesReferentiel,
} from "@/lib/banque";

export const PHOTO_MAX_OCTETS = 5 * 1024 * 1024;

export function sessionDeRequete(req: Request, magasin: Magasin): SessionServeur | null {
  const jeton = req.headers.get("cookie")?.split("; ").find((c) => c.startsWith(`${NOM_COOKIE}=`))?.split("=")[1];
  return verifierSession(magasin, jeton);
}

/* ——— État servi au client : son compte + le référentiel effectif ——— */
export function ouvrirBanquePour(magasin: Magasin, email: string, role: string, maintenant: string): BanqueCompte {
  magasin.banques = magasin.banques ?? {};
  const cle = cleBanque(email, role);
  if (!magasin.banques[cle]) {
    // Le compte de démonstration arrive « vitrine » : vérifié, avec historique et chat, pour que
    // chaque état du pipeline soit illustré d'un coup d'œil (données fictives étiquetées démo).
    if (role === "CUSTOMER" && email.trim().toLowerCase() === COMPTES_PORTE_DEMO[0].email) {
      const vitrine = banqueDemoIllustrative();
      magasin.banques[cle] = vitrine.compte;
      magasin.chats = magasin.chats ?? {};
      if (!magasin.chats[cle] || magasin.chats[cle].length === 0) magasin.chats[cle] = vitrine.chat;
    } else {
      magasin.banques[cle] = ouvrirBanqueClient(email, role, maintenant);
    }
  }
  return magasin.banques[cle];
}
export function referentielDuMagasin(magasin: Magasin): Referentiel {
  return referentielEffectif(magasin.surcharges ?? {});
}

export function banqueDeSession(magasin: Magasin, session: SessionServeur): { compte: BanqueCompte; referentiel: Referentiel } | { erreur: string; statut: number } {
  if (session.role !== "CUSTOMER") return { erreur: "reserve_client", statut: 403 };
  return { compte: ouvrirBanquePour(magasin, session.email, session.role, new Date().toISOString()), referentiel: referentielDuMagasin(magasin) };
}

/* ——— Actions du client sur SON compte ——— */
export function actionClient(
  magasin: Magasin, session: SessionServeur,
  corps: { action?: string; beneficiaireNom?: string; beneficiaireIban?: string; beneficiaireAdresse?: string; beneficiaireBic?: string; montant?: number; motif?: string; virementId?: string; texte?: string; photo?: string | null },
): { statut: number; corps: Record<string, unknown>; modifie: boolean } {
  if (session.role !== "CUSTOMER") return { statut: 403, corps: { erreur: "reserve_client" }, modifie: false };
  const compte = ouvrirBanquePour(magasin, session.email, session.role, new Date().toISOString());
  const maintenant = new Date().toISOString();

  if (corps.action === "virement") {
    // L'ordre de virement complet exige l'adresse du bénéficiaire et un BIC/SWIFT valide.
    if (!String(corps.beneficiaireAdresse ?? "").trim()) return { statut: 400, corps: { erreur: "adresse_manquante" }, modifie: false };
    if (!bicValide(String(corps.beneficiaireBic ?? ""))) return { statut: 400, corps: { erreur: "bic_invalide" }, modifie: false };
    const r = initierVirement(
      compte, String(corps.beneficiaireNom ?? ""), String(corps.beneficiaireIban ?? ""), Number(corps.montant), String(corps.motif ?? ""), maintenant,
      { adresse: String(corps.beneficiaireAdresse ?? ""), bic: String(corps.beneficiaireBic ?? "") },
    );
    if (r.erreur) return { statut: 400, corps: { erreur: r.erreur }, modifie: false };
    magasin.banques![cleBanque(session.email, session.role)] = r.compte;
    return { statut: 200, corps: { compte: r.compte }, modifie: true };
  }
  if (corps.action === "annuler") {
    if (typeof corps.virementId !== "string") return { statut: 400, corps: { erreur: "champs_manquants" }, modifie: false };
    const v = compte.virements.find((x) => x.id === corps.virementId);
    if (!v || (v.statut !== "EN_COURS" && v.statut !== "BLOQUE")) return { statut: 400, corps: { erreur: "etat_inchange" }, modifie: false };
    const neuf = annulerVirement(compte, corps.virementId);
    magasin.banques![cleBanque(session.email, session.role)] = neuf;
    return { statut: 200, corps: { compte: neuf }, modifie: true };
  }
  if (corps.action === "chat") {
    const texte = String(corps.texte ?? "").trim();
    if (!texte) return { statut: 400, corps: { erreur: "champs_manquants" }, modifie: false };
    const cle = cleBanque(session.email, session.role);
    magasin.chats = magasin.chats ?? {};
    const message: MessageChat = { id: `MSG-${Date.now()}-${Math.floor(Math.random() * 1e4)}`, de: "client", auteur: session.nom, texte, ts: maintenant };
    magasin.chats[cle] = [...(magasin.chats[cle] ?? []), message];
    return { statut: 200, corps: { messages: magasin.chats[cle] }, modifie: true };
  }
  if (corps.action === "photo") {
    const photo = corps.photo === null ? null : typeof corps.photo === "string" ? corps.photo : undefined;
    if (photo === undefined) return { statut: 400, corps: { erreur: "champs_manquants" }, modifie: false };
    if (photo !== null && photo.length > PHOTO_MAX_OCTETS) return { statut: 413, corps: { erreur: "photo_trop_lourde" }, modifie: false };
    const neuf = { ...compte, photo };
    magasin.banques![cleBanque(session.email, session.role)] = neuf;
    return { statut: 200, corps: { compte: neuf }, modifie: true };
  }
  return { statut: 400, corps: { erreur: "action_inconnue" }, modifie: false };
}

/* ——— Vue de l'administration : tous les comptes clients (dossier complet : profil + KYC) ——— */
export function listeComptesClients(magasin: Magasin): Array<{
  id: string; email: string; nom: string; creeA: string; profil: Record<string, string> | null; compte: BanqueCompte;
}> {
  ouvrirToutesLesBanques(magasin);
  return magasin.comptes
    .filter((c) => c.role === "CUSTOMER")
    .map((c) => ({
      id: cleBanque(c.email, c.role), email: c.email, nom: c.nom, creeA: c.creeA,
      profil: c.profil ?? null,
      compte: magasin.banques![cleBanque(c.email, c.role)],
    }))
    .filter((x) => x.compte);
}
function ouvrirToutesLesBanques(magasin: Magasin): void {
  const maintenant = new Date().toISOString();
  for (const c of magasin.comptes.filter((x) => x.role === "CUSTOMER")) ouvrirBanquePour(magasin, c.email, c.role, maintenant);
}

/* ——— Actions de l'administration ——— */
export function actionAdmin(
  magasin: Magasin, session: SessionServeur,
  corps: { action?: string; compteId?: string; virementId?: string; verifie?: boolean; montant?: number; motif?: string; codeDefaut?: string; texte?: string },
): { statut: number; corps: Record<string, unknown>; modifie: boolean } {
  if (session.role === "CUSTOMER") return { statut: 403, corps: { erreur: "reserve_staff" }, modifie: false };
  const ref = referentielDuMagasin(magasin);
  const maintenant = new Date().toISOString();
  const compteId = typeof corps.compteId === "string" ? corps.compteId : "";
  const compte = magasin.banques?.[compteId];
  const persister = (neuf: BanqueCompte) => { magasin.banques = magasin.banques ?? {}; magasin.banques[compteId] = neuf; };

  if (corps.action === "verifier") {
    if (!compte) return { statut: 404, corps: { erreur: "compte_introuvable" }, modifie: false };
    persister({ ...compte, verifie: Boolean(corps.verifie) });
    return { statut: 200, corps: { compte: magasin.banques![compteId] }, modifie: true };
  }
  if (corps.action === "crediter") {
    if (!compte) return { statut: 404, corps: { erreur: "compte_introuvable" }, modifie: false };
    const montant = Number(corps.montant);
    if (!(montant > 0)) return { statut: 400, corps: { erreur: "montant_invalide" }, modifie: false };
    const neuf: BanqueCompte = {
      ...compte,
      transactions: [...compte.transactions, {
        id: `TX-OPS-${Date.now()}`, sens: "entrant", montant, date: maintenant,
        contrepartie: session.nom, motifLibre: String(corps.motif ?? "").trim() || "banque.tx.in",
      }],
    };
    persister(neuf);
    return { statut: 200, corps: { compte: neuf }, modifie: true };
  }
  if (corps.action === "confirmer") {
    if (!compte || typeof corps.virementId !== "string") return { statut: 400, corps: { erreur: "champs_manquants" }, modifie: false };
    const v = compte.virements.find((x) => x.id === corps.virementId);
    if (!v || v.statut !== "EN_COURS" || v.niveau >= ref.pipeline.length) return { statut: 400, corps: { erreur: "etat_inchange" }, modifie: false };
    const confirme = confirmerNiveau(compte, corps.virementId, ref);
    const apres = confirme.virements.find((x) => x.id === corps.virementId);
    const neuf = apres?.statut === "EXECUTE" ? denouer(confirme, corps.virementId, maintenant) : confirme;
    persister(neuf);
    return { statut: 200, corps: { compte: neuf }, modifie: true };
  }
  if (corps.action === "bloquer") {
    if (!compte || typeof corps.virementId !== "string" || typeof corps.codeDefaut !== "string") {
      return { statut: 400, corps: { erreur: "champs_manquants" }, modifie: false };
    }
    const v = compte.virements.find((x) => x.id === corps.virementId);
    const defaut = ref.defauts.find((d) => d.code === corps.codeDefaut && d.actif);
    if (!v || v.statut !== "EN_COURS" || !defaut) return { statut: 400, corps: { erreur: "etat_inchange" }, modifie: false };
    const neuf = bloquerVirement(compte, corps.virementId, corps.codeDefaut, ref, maintenant);
    persister(neuf);
    return { statut: 200, corps: { compte: neuf }, modifie: true };
  }
  if (corps.action === "lever") {
    if (!compte || typeof corps.virementId !== "string") return { statut: 400, corps: { erreur: "champs_manquants" }, modifie: false };
    const v = compte.virements.find((x) => x.id === corps.virementId);
    if (!v || v.statut !== "BLOQUE") return { statut: 400, corps: { erreur: "etat_inchange" }, modifie: false };
    const neuf = leverBlocage(compte, corps.virementId, maintenant);
    persister(neuf);
    return { statut: 200, corps: { compte: neuf }, modifie: true };
  }
  if (corps.action === "refuser") {
    if (!compte || typeof corps.virementId !== "string") return { statut: 400, corps: { erreur: "champs_manquants" }, modifie: false };
    const v = compte.virements.find((x) => x.id === corps.virementId);
    if (!v || (v.statut !== "EN_COURS" && v.statut !== "BLOQUE")) return { statut: 400, corps: { erreur: "etat_inchange" }, modifie: false };
    const neuf = refuserVirement(compte, corps.virementId);
    persister(neuf);
    return { statut: 200, corps: { compte: neuf }, modifie: true };
  }
  if (corps.action === "chat") {
    const texte = String(corps.texte ?? "").trim();
    if (!compteId || !texte) return { statut: 400, corps: { erreur: "champs_manquants" }, modifie: false };
    magasin.chats = magasin.chats ?? {};
    const message: MessageChat = { id: `MSG-${Date.now()}-${Math.floor(Math.random() * 1e4)}`, de: "support", auteur: session.nom, texte, ts: maintenant };
    magasin.chats[compteId] = [...(magasin.chats[compteId] ?? []), message];
    return { statut: 200, corps: { messages: magasin.chats[compteId] }, modifie: true };
  }
  return { statut: 400, corps: { erreur: "action_inconnue" }, modifie: false };
}

/* ——— Chat : lecture (client → le sien ; staff → celui du compte demandé) ——— */
export function chatPour(magasin: Magasin, session: SessionServeur, compteId?: string): { messages: MessageChat[] } | { erreur: string; statut: number } {
  if (session.role === "CUSTOMER") {
    return { messages: magasin.chats?.[cleBanque(session.email, session.role)] ?? [] };
  }
  if (typeof compteId !== "string" || !compteId) return { erreur: "champs_manquants", statut: 400 };
  return { messages: magasin.chats?.[compteId] ?? [] };
}

/* ——— Référentiel : lecture + surcharges réservées à l'administration ——— */
export function referentielPourApi(magasin: Magasin) {
  return { referentiel: referentielDuMagasin(magasin), surcharges: magasin.surcharges ?? {} };
}
export function surchargerReferentiel(magasin: Magasin, session: SessionServeur, corps: { code?: string; cout?: number; actif?: boolean }): { statut: number; corps: Record<string, unknown> } {
  if (session.role === "CUSTOMER") return { statut: 403, corps: { erreur: "reserve_staff" } };
  const code = corps.code;
  if (typeof code !== "string" || !referentielDuMagasin(magasin).defauts.some((d) => d.code === code)) {
    return { statut: 400, corps: { erreur: "code_inconnu" } };
  }
  const surcharge: { cout?: number; actif?: boolean } = { ...magasin.surcharges?.[code] };
  if (typeof corps.cout === "number" && corps.cout >= 0) surcharge.cout = corps.cout;
  if (typeof corps.actif === "boolean") surcharge.actif = corps.actif;
  magasin.surcharges = { ...(magasin.surcharges ?? {}), [code]: surcharge };
  return { statut: 200, corps: referentielPourApi(magasin) };
}

export type { SurchargesReferentiel };
