/**
 * Slice 10 — client de l'API serveur. URLs RELATIVES uniquement (jamais de localhost codé en dur :
 * le navigateur parle au même hôte que celui qui sert la page, le serveur Next route /api vers les
 * Route Handlers Node).
 */
export interface SessionApi { email: string; role: "CUSTOMER" | "ADMIN" | "SUPER_ADMIN"; nom: string; ouverteA: string }
export interface ReponseApi<T> { ok: boolean; statut: number; corps: T & { erreur?: string } }

async function requete<T>(chemin: string, init?: RequestInit): Promise<ReponseApi<T>> {
  try {
    const reponse = await fetch(chemin, { credentials: "same-origin", ...init });
    const corps = (await reponse.json().catch(() => ({ erreur: "reponse_invalide" }))) as T & { erreur?: string };
    return { ok: reponse.ok, statut: reponse.status, corps };
  } catch {
    return { ok: false, statut: 0, corps: { erreur: "reseau" } as T & { erreur?: string } };
  }
}

export const apiGet = <T>(chemin: string) => requete<T>(chemin);
export const apiPost = <T>(chemin: string, corps: unknown, extra?: RequestInit) =>
  requete<T>(chemin, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corps),
    ...extra,
  });

/* Endpoints nommés — un seul endroit pour les chemins de l'API. */
export const API = {
  inscription: "/api/auth/inscription",
  connexion: "/api/auth/connexion",
  deconnexion: "/api/auth/deconnexion",
  session: "/api/auth/session",
  mdp: "/api/auth/mdp",
  profil: "/api/auth/profil",
  grille: "/api/grille",
  grilleSonde: (date: string) => `/api/grille/sonde?date=${date}`,
  simuler: "/api/simuler",
  banque: "/api/banque",
  banqueComptes: "/api/banque/comptes",
  banqueOperations: "/api/banque/operations",
  banqueChat: (compte?: string) => (compte ? `/api/banque/chat?compte=${encodeURIComponent(compte)}` : "/api/banque/chat"),
  banqueReferentiel: "/api/banque/referentiel",
} as const;
