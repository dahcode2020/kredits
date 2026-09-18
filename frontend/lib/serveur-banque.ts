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
import { NOM_COOKIE, deposerNotification, enregistrerVirementEntrant, notifierClient, verifierSession, type Magasin, type SessionServeur } from "@/lib/serveur";
import { COMPTES_PORTE_DEMO, banqueDemoIllustrative } from "@/lib/serveur-demo";
import {
  annulerVirement, avancerVirements, bicValide, cleBanque, debloquerParCode, denouer, initierVirement,
  leverBlocage, ouvrirBanqueClient, referentielEffectif, refuserVirement, soldeDe,
  type BanqueCompte, type EvenementPipeline, type MessageChat, type Referentiel, type SurchargesReferentiel,
} from "@/lib/banque";

export const PHOTO_MAX_OCTETS = 5 * 1024 * 1024;

/** Rétention du chat : une conversation ne vit jamais plus d'UNE SEMAINE. Tout message plus vieux
 *  que 7 jours est effacé automatiquement (gain d'espace) — à chaque lecture et à chaque écriture. */
export const DUREE_CONVERSATION_MS = 7 * 24 * 60 * 60 * 1000;
/** Purge pure : ne garde que les messages de la dernière semaine. */
export function purgerMessagesChat(messages: MessageChat[], maintenant: string): MessageChat[] {
  const limite = new Date(maintenant).getTime() - DUREE_CONVERSATION_MS;
  return messages.filter((m) => new Date(m.ts).getTime() > limite);
}

/** Code de déblocage d'un niveau d'arrêt : généré automatiquement, 12 caractères alphanumériques
 *  non ambigus, émis par le serveur à chaque arrêt (jamais servi au client). */
const ALPHABET_CODE = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
export function genererCodeDeblocage(): string {
  let s = "";
  for (let i = 0; i < 12; i++) s += ALPHABET_CODE[Math.floor(Math.random() * ALPHABET_CODE.length)];
  return s;
}

/** Vue du compte pour LE CLIENT : le code de déblocage d'un arrêt ne doit jamais lui être servi. */
export function vueClientCompte(compte: BanqueCompte): BanqueCompte {
  return { ...compte, virements: compte.virements.map((v) => ({ ...v, codeDeblocage: undefined })) };
}

/** Libellés canoniques des niveaux (les mêmes clés que l'administration) — servies comme
 *  variables-clés des notifications : `tSiCle` les résout dans la langue du client. */
const CLES_NIVEAUX_CANONIQUES: Record<string, string> = {
  RECEPTION: "banque:pipeline.RECEPTION", CONFORMITE: "banque:pipeline.CONFORMITE",
  CERTIFICATS: "banque:pipeline.CERTIFICATS", EXECUTION: "banque:pipeline.EXECUTION",
};

/** Progression en direct (slice 22) : fait avancer le compte du client jusqu'à maintenant.
 *  Chaque palier confirmé devient une notification SITE ; les virements exécutés sont dénoués
 *  immédiatement (ledger). Les événements ARRET / EXECUTION sont retournés : la route les
 *  distribue sur les canaux réels via `notifierEvenementsPipeline`. */
export function avancerEtNotifier(magasin: Magasin, email: string, role: string, maintenant: string): EvenementPipeline[] {
  if (role !== "CUSTOMER") return [];
  const cle = cleBanque(email, role);
  const compte = magasin.banques?.[cle];
  if (!compte) return [];
  const r = avancerVirements(compte, referentielDuMagasin(magasin), maintenant, genererCodeDeblocage);
  if (r.evenements.length === 0) return [];
  let neuf = r.compte;
  for (const e of r.evenements) if (e.type === "EXECUTION") neuf = denouer(neuf, e.virementId, maintenant);
  magasin.banques![cle] = neuf;
  for (const e of r.evenements) {
    if (e.type !== "NIVEAU") continue; // palier intermédiaire : site uniquement, pas d'e-mail
    const cleNiveau = CLES_NIVEAUX_CANONIQUES[e.codeNiveau];
    deposerNotification(magasin, cleNiveau
      ? { email, cle: "banque.vir.notify.level", vars: { nom: cleNiveau, pct: String(e.pct) }, maintenant }
      : { email, cle: "banque.vir.notify.levelCustom", vars: { pct: String(e.pct) }, maintenant });
  }
  return r.evenements;
}

/** Les événements IMPORTANTS (arrêt exigeant un code, exécution) partent sur les canaux réels :
 *  site + e-mail + WhatsApp selon les préférences du client (slice 21). */
export async function notifierEvenementsPipeline(magasin: Magasin, email: string, evenements: EvenementPipeline[], maintenant: string): Promise<void> {
  const compte = magasin.banques?.[cleBanque(email, "CUSTOMER")];
  for (const e of evenements) {
    const v = compte?.virements.find((x) => x.id === e.virementId);
    if (!v) continue;
    if (e.type === "ARRET") {
      const b = v.blocages.filter((x) => !x.leveA).at(-1);
      await notifierClient(magasin, {
        email, cle: "banque.vir.notify.stop",
        vars: { motif: b?.motif ?? `banque:defaut.${e.codesDefauts[0] ?? ""}` }, maintenant,
      });
    }
    if (e.type === "EXECUTION") {
      await notifierClient(magasin, {
        email, cle: "banque.vir.notify.done", vars: { beneficiaire: v.beneficiaireNom }, maintenant,
      });
    }
  }
}

export function sessionDeRequete(req: Request, magasin: Magasin): SessionServeur | null {
  const jeton = req.headers.get("cookie")?.split("; ").find((c) => c.startsWith(`${NOM_COOKIE}=`))?.split("=")[1];
  return verifierSession(magasin, jeton);
}

/* ——— État servi au client : son compte + le référentiel effectif ——— */
/** Un compte stocké SANS aucun mouvement est un compte corrompu (vieux magasin manipulé hors du
 *  code courant) : un vrai compte a toujours au moins la dotation d'ouverture. Plutôt que
 *  d'afficher un solde à 0,00 € qui n'existe pas, on l'écarte et on le re-sème — même
 *  philosophie que VERSION_MAGASIN, appliquée compte par compte. */
export function compteIntact(compte: BanqueCompte | undefined): compte is BanqueCompte {
  return Boolean(
    compte && typeof compte.iban === "string" && typeof compte.verifie === "boolean"
      && Array.isArray(compte.transactions) && compte.transactions.length > 0
      && Array.isArray(compte.virements),
  );
}
export function ouvrirBanquePour(magasin: Magasin, email: string, role: string, maintenant: string): BanqueCompte {
  magasin.banques = magasin.banques ?? {};
  const cle = cleBanque(email, role);
  if (!compteIntact(magasin.banques[cle])) {
    delete magasin.banques[cle]; // état corrompu/vide écarté, jamais réutilisé
    // Le compte de démonstration arrive « vitrine » : vérifié, avec historique et chat, pour que
    // chaque état du pipeline soit illustré d'un coup d'œil (données fictives étiquetées démo).
    if (role === "CUSTOMER" && email.trim().toLowerCase() === COMPTES_PORTE_DEMO[0].email) {
      const vitrine = banqueDemoIllustrative(maintenant);
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
  return { compte: vueClientCompte(ouvrirBanquePour(magasin, session.email, session.role, new Date().toISOString())), referentiel: referentielDuMagasin(magasin) };
}

/* ——— Actions du client sur SON compte ——— */
export function actionClient(
  magasin: Magasin, session: SessionServeur,
  corps: { action?: string; beneficiaireNom?: string; beneficiaireIban?: string; beneficiaireAdresse?: string; beneficiaireBic?: string; montant?: number; motif?: string; virementId?: string; code?: string; texte?: string; photo?: string | null },
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
    // La progression en direct démarre à l'initiation (premier palier à l'échéance) : le client
    // suit la barre et reçoit une notification à chaque palier — le serveur n'avance rien ici.
    magasin.banques![cleBanque(session.email, session.role)] = r.compte;
    return { statut: 200, corps: { compte: vueClientCompte(r.compte) }, modifie: true };
  }
  if (corps.action === "debloquer") {
    // Le client fournit le code émis par l'administration : le niveau se débloque et la barre repart.
    if (typeof corps.virementId !== "string" || typeof corps.code !== "string") return { statut: 400, corps: { erreur: "champs_manquants" }, modifie: false };
    const r = debloquerParCode(compte, corps.virementId, corps.code, maintenant);
    if (!r.ok) return { statut: 400, corps: { erreur: "code_invalide" }, modifie: false };
    // La machine repart à la cadence habituelle : palier suivant confirmé à l'échéance replanifiée.
    magasin.banques![cleBanque(session.email, session.role)] = r.compte;
    return { statut: 200, corps: { compte: vueClientCompte(r.compte) }, modifie: true };
  }
  if (corps.action === "annuler") {
    if (typeof corps.virementId !== "string") return { statut: 400, corps: { erreur: "champs_manquants" }, modifie: false };
    const v = compte.virements.find((x) => x.id === corps.virementId);
    if (!v || (v.statut !== "EN_COURS" && v.statut !== "BLOQUE")) return { statut: 400, corps: { erreur: "etat_inchange" }, modifie: false };
    const neuf = annulerVirement(compte, corps.virementId);
    magasin.banques![cleBanque(session.email, session.role)] = neuf;
    return { statut: 200, corps: { compte: vueClientCompte(neuf) }, modifie: true };
  }
  if (corps.action === "chat") {
    const texte = String(corps.texte ?? "").trim();
    if (!texte) return { statut: 400, corps: { erreur: "champs_manquants" }, modifie: false };
    const cle = cleBanque(session.email, session.role);
    magasin.chats = magasin.chats ?? {};
    // Rétention 7 jours : la purge précède chaque nouveau message.
    const message: MessageChat = { id: `MSG-${Date.now()}-${Math.floor(Math.random() * 1e4)}`, de: "client", auteur: session.nom, texte, ts: maintenant };
    magasin.chats[cle] = [...purgerMessagesChat(magasin.chats[cle] ?? [], maintenant), message];
    return { statut: 200, corps: { messages: magasin.chats[cle] }, modifie: true };
  }
  if (corps.action === "photo") {
    const photo = corps.photo === null ? null : typeof corps.photo === "string" ? corps.photo : undefined;
    if (photo === undefined) return { statut: 400, corps: { erreur: "champs_manquants" }, modifie: false };
    if (photo !== null && photo.length > PHOTO_MAX_OCTETS) return { statut: 413, corps: { erreur: "photo_trop_lourde" }, modifie: false };
    const neuf = { ...compte, photo };
    magasin.banques![cleBanque(session.email, session.role)] = neuf;
    return { statut: 200, corps: { compte: vueClientCompte(neuf) }, modifie: true };
  }
  return { statut: 400, corps: { erreur: "action_inconnue" }, modifie: false };
}

/* ——— Vue de l'administration : tous les comptes clients (dossier complet : profil + KYC) ——— */
export function listeComptesClients(magasin: Magasin): Array<{
  id: string; email: string; nom: string; creeA: string; profil: Record<string, string> | null; compte: BanqueCompte;
  docsEnAttente: number; chatNonLu: boolean;
}> {
  ouvrirToutesLesBanques(magasin);
  const maintenant = new Date().toISOString();
  return magasin.comptes
    .filter((c) => c.role === "CUSTOMER")
    .map((c) => {
      const id = cleBanque(c.email, c.role);
      // Le KYC se valide DOSSIER EN MAINS : on remonte le nombre de pièces encore à approuver,
      // et si le dernier mot du chat revient au client (message resté sans réponse).
      const messages = purgerMessagesChat(magasin.chats?.[id] ?? [], maintenant);
      const dernierClient = [...messages].reverse().find((m) => m.de === "client");
      const dernierSupport = [...messages].reverse().find((m) => m.de === "support");
      return {
        id, email: c.email, nom: c.nom, creeA: c.creeA,
        profil: c.profil ?? null,
        compte: magasin.banques![id],
        docsEnAttente: (magasin.documents ?? []).filter((d) => d.email === c.email && d.statut === "SOUMIS").length,
        chatNonLu: Boolean(dernierClient && (!dernierSupport || dernierClient.ts > dernierSupport.ts)),
      };
    })
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
    // Le virement entrant est listé dans le menu Paiements du client, déjà encaissé.
    enregistrerVirementEntrant(magasin, compteId.split("::")[0], montant, String(corps.motif ?? ""), maintenant);
    return { statut: 200, corps: { compte: neuf }, modifie: true };
  }
  if (corps.action === "lever") {
    // Geste d'administration : lève le blocage SANS code — la progression en direct reprend à la
    // cadence habituelle (palier suivant à l'échéance replanifiée par leverBlocage).
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
    // Rétention 7 jours : la purge précède chaque nouveau message.
    const message: MessageChat = { id: `MSG-${Date.now()}-${Math.floor(Math.random() * 1e4)}`, de: "support", auteur: session.nom, texte, ts: maintenant };
    magasin.chats[compteId] = [...purgerMessagesChat(magasin.chats[compteId] ?? [], maintenant), message];
    return { statut: 200, corps: { messages: magasin.chats[compteId] }, modifie: true };
  }
  return { statut: 400, corps: { erreur: "action_inconnue" }, modifie: false };
}

/* ——— Chat : lecture (client → le sien ; staff → celui du compte demandé). La purge 7 jours
 *  s'applique à CHAQUE lecture : une conversation ne survit jamais plus d'une semaine, même sans
 *  nouvelle écriture. `purge` indique si des messages ont été effacés (l'API persiste alors). ——— */
export function chatPour(magasin: Magasin, session: SessionServeur, compteId?: string, maintenant?: string): { messages: MessageChat[]; purge: boolean } | { erreur: string; statut: number } {
  const cle = session.role === "CUSTOMER" ? cleBanque(session.email, session.role) : compteId;
  if (session.role !== "CUSTOMER" && (typeof cle !== "string" || !cle)) return { erreur: "champs_manquants", statut: 400 };
  maintenant = maintenant ?? new Date().toISOString();
  const bruts = magasin.chats?.[cle as string] ?? [];
  const messages = purgerMessagesChat(bruts, maintenant);
  const purge = messages.length !== bruts.length;
  if (purge) { magasin.chats = magasin.chats ?? {}; magasin.chats[cle as string] = messages; }
  return { messages, purge };
}

/* ——— Référentiel : lecture + surcharges réservées à l'administration ——— */
export function referentielPourApi(magasin: Magasin) {
  return { referentiel: referentielDuMagasin(magasin), surcharges: magasin.surcharges ?? {} };
}
/** L'administration définit, pour chaque champ de progression : le niveau (pct), le montant à
 *  payer (cout), le statut (actif), le motif du paiement (motif) — et peut CRÉER de nouveaux
 *  champs (`creer`), qui ajoutent leur niveau à la barre si nécessaire. */
export function surchargerReferentiel(
  magasin: Magasin, session: SessionServeur,
  corps: { code?: string; cout?: number; actif?: boolean; pct?: number; motif?: string; creer?: boolean },
): { statut: number; corps: Record<string, unknown> } {
  if (session.role === "CUSTOMER") return { statut: 403, corps: { erreur: "reserve_staff" } };
  const code = String(corps.code ?? "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{2,24}$/.test(code)) return { statut: 400, corps: { erreur: "code_invalide" } };
  const pctValide = (n: unknown): n is number => Number.isInteger(n) && (n as number) > 0 && (n as number) <= 100;
  const existant = referentielDuMagasin(magasin).defauts.some((d) => d.code === code);
  const surcharge: { cout?: number; actif?: boolean; pct?: number; motif?: string; cree?: boolean } = { ...magasin.surcharges?.[code] };
  if (!existant && !surcharge.cree) {
    if (!corps.creer) return { statut: 400, corps: { erreur: "code_inconnu" } };
    if (!pctValide(corps.pct)) return { statut: 400, corps: { erreur: "pct_invalide" } };
    surcharge.cree = true;
    surcharge.pct = corps.pct;
  }
  if (corps.pct !== undefined) {
    if (!pctValide(corps.pct)) return { statut: 400, corps: { erreur: "pct_invalide" } };
    surcharge.pct = corps.pct;
  }
  if (typeof corps.cout === "number" && corps.cout >= 0) surcharge.cout = Math.round(corps.cout * 100) / 100;
  if (typeof corps.actif === "boolean") surcharge.actif = corps.actif;
  if (typeof corps.motif === "string") surcharge.motif = corps.motif.trim().slice(0, 120);
  magasin.surcharges = { ...(magasin.surcharges ?? {}), [code]: surcharge };
  return { statut: 200, corps: referentielPourApi(magasin) };
}

export type { SurchargesReferentiel };

/* ——— « L'œil de l'administrateur » : l'Aperçu exhaustif de la plateforme, en temps réel ——— */
/** Une ligne du fil d'activité : qui, quoi, quand. Le type pilote l'icône et le verbe à l'écran. */
export interface EvenementPlateforme {
  ts: string; type: "credit" | "debit" | "chat" | "kyc" | "virement";
  email: string; nom: string; montant?: number; detail?: string;
}
export interface ApercuPlateforme {
  totaux: {
    clients: number; kycVerifies: number; kycEnAttente: number;
    transactions: number; volumeEntrant: number; volumeSortant: number; soldeCumule: number;
    virementsActifs: number; messagesChat: number;
  };
  recent: EvenementPlateforme[];
}
export function apercuPlateforme(magasin: Magasin): ApercuPlateforme {
  ouvrirToutesLesBanques(magasin);
  const maintenant = new Date().toISOString();
  const clients = magasin.comptes.filter((c) => c.role === "CUSTOMER");
  const dossiers = clients
    .map((c) => ({ client: c, compte: magasin.banques![cleBanque(c.email, c.role)] }))
    .filter((x): x is { client: (typeof clients)[number]; compte: BanqueCompte } => Boolean(x.compte));
  let volumeEntrant = 0, volumeSortant = 0, transactions = 0, virementsActifs = 0, soldeCumule = 0;
  const recent: EvenementPlateforme[] = [];
  for (const { client, compte } of dossiers) {
    const email = client.email.toLowerCase();
    soldeCumule += soldeDe(compte);
    for (const t of compte.transactions) {
      transactions += 1;
      if (t.sens === "entrant") volumeEntrant += t.montant; else volumeSortant += t.montant;
      recent.push({ ts: t.date, type: t.sens === "entrant" ? "credit" : "debit", email, nom: client.nom, montant: t.montant, detail: t.contrepartie });
    }
    for (const v of compte.virements) {
      if (v.statut === "EN_COURS" || v.statut === "BLOQUE") virementsActifs += 1;
      recent.push({ ts: v.creeA, type: "virement", email, nom: client.nom, montant: v.montant, detail: v.beneficiaireNom });
    }
    recent.push({
      ts: client.creeA, type: "kyc", email, nom: client.nom,
      detail: compte.verifie ? "verifie" : "attente",
    });
  }
  for (const [cle, messages] of Object.entries(magasin.chats ?? {})) {
    const email = cle.split("::")[0];
    const nom = dossiers.find((d) => d.client.email.toLowerCase() === email)?.client.nom ?? email;
    for (const m of purgerMessagesChat(messages, maintenant)) {
      recent.push({ ts: m.ts, type: "chat", email, nom, detail: m.texte.slice(0, 90) });
    }
  }
  const kycVerifies = dossiers.filter((d) => d.compte.verifie).length;
  return {
    totaux: {
      clients: clients.length, kycVerifies, kycEnAttente: clients.length - kycVerifies,
      transactions, volumeEntrant, volumeSortant, soldeCumule, virementsActifs,
      messagesChat: Object.values(magasin.chats ?? {}).reduce((s, m) => s + purgerMessagesChat(m, maintenant).length, 0),
    },
    recent: recent.sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 30),
  };
}
