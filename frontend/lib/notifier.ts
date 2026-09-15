/**
 * Distribution réelle des notifications importantes — deux fournisseurs GRATUITS, appelés en
 * HTTP pur (aucune dépendance) :
 *
 * - E-MAIL : **Resend** (plan gratuit : 3 000 e-mails/mois, 100/jour) —
 *   `POST https://api.resend.com/emails`, Authorization Bearer.
 *   Variables : `KREDIT_RESEND_KEY` + `KREDIT_EMAIL_FROM` (ex. `KREDIT <notifications@votredomaine.be>`).
 *
 * - WHATSAPP : **API Cloud officielle de Meta** (gratuit : 1 000 conversations de service/mois) —
 *   `POST https://graph.facebook.com/v21.0/{PHONE_ID}/messages`.
 *   Variables : `KREDIT_WHATSAPP_TOKEN` + `KREDIT_WHATSAPP_PHONE_ID`.
 *
 * Honnêteté : SANS clés, l'envoi n'est jamais simulé — le canal est marqué `non_configure` et
 * l'UI le montre. Une erreur réseau/API est marquée `echec`. Rien ne « part en silence ».
 */

export type StatutEnvoi = "envoye" | "echec" | "non_configure" | "desactive";
export type FetchImpl = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number }>;

export interface ConfigNotif {
  resend?: { cle: string; de: string };
  whatsapp?: { jeton: string; idTelephone: string };
}

/** Lit la configuration depuis l'environnement ; un fournisseur absent → canal non configuré. */
export function configNotifDepuisEnv(env: Record<string, string | undefined>): ConfigNotif {
  const cfg: ConfigNotif = {};
  if (env.KREDIT_RESEND_KEY && env.KREDIT_EMAIL_FROM) {
    cfg.resend = { cle: env.KREDIT_RESEND_KEY, de: env.KREDIT_EMAIL_FROM };
  }
  if (env.KREDIT_WHATSAPP_TOKEN && env.KREDIT_WHATSAPP_PHONE_ID) {
    cfg.whatsapp = { jeton: env.KREDIT_WHATSAPP_TOKEN, idTelephone: env.KREDIT_WHATSAPP_PHONE_ID };
  }
  return cfg;
}

/** Numéro international normalisé pour l'API WhatsApp : « +32 470 12 34 56 » → « +32470123456 ». */
export function numeroInternational(brut: string): string | null {
  const compact = brut.replace(/[\s().-]/g, "");
  if (!/^\+\d{8,15}$/.test(compact)) return null;
  return compact;
}

/** E-mail via Resend. `fetchImpl` est injectable (verrous jest sans réseau). */
export async function envoyerEmailResend(
  cfg: ConfigNotif["resend"] | undefined, vers: string, sujet: string, texte: string, fetchImpl: FetchImpl = fetch,
): Promise<StatutEnvoi> {
  if (!cfg) return "non_configure";
  try {
    const r = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.cle}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: cfg.de, to: [vers], subject: sujet, text: texte }),
    });
    return r.ok ? "envoye" : "echec";
  } catch {
    return "echec";
  }
}

/** WhatsApp via l'API Cloud de Meta (message texte de service). */
export async function envoyerWhatsAppMeta(
  cfg: ConfigNotif["whatsapp"] | undefined, vers: string, texte: string, fetchImpl: FetchImpl = fetch,
): Promise<StatutEnvoi> {
  if (!cfg) return "non_configure";
  try {
    const r = await fetchImpl(`https://graph.facebook.com/v21.0/${encodeURIComponent(cfg.idTelephone)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.jeton}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: vers, type: "text", text: { preview_url: false, body: texte } }),
    });
    return r.ok ? "envoye" : "echec";
  } catch {
    return "echec";
  }
}
