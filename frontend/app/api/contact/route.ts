import { NextResponse } from "next/server";
import {
  NOM_COOKIE, deposerMessageContact, ecrireMagasin, lireMagasin, messagesContact,
  notifierClient, notifierStaff, traiterMessageContact, verifierSession,
} from "@/lib/serveur";
import { locales, t, type Locale } from "@/lib/i18n";
// La table erreur→clé i18n vit dans lib/contact.ts (isomorphe) : la route et le formulaire
// du navigateur lisent LA MÊME table, jamais deux mappings parallèles.
import { CLES_ERREUR_CONTACT } from "@/lib/contact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jetonDe(req: Request): string | undefined {
  return req.headers.get("cookie")?.split("; ").find((c) => c.startsWith(`${NOM_COOKIE}=`))?.split("=")[1];
}
function echapper(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * POST /api/contact — le formulaire du menu Contact (bas de page), SANS session : c'est le
 * seul point d'entrée public de l'API, et il ne rend jamais de promesse automatique.
 *
 * Deux formes, une seule logique :
 *  - `application/json` (fetch, le cas normal) → réponse JSON avec la référence du message ;
 *  - `application/x-www-form-urlencoded` (formulaire natif, donc **sans JavaScript**) →
 *    réponse HTML lisible. Échappatoire n°2 : un visiteur sans JS doit pouvoir écrire, pas
 *    seulement lire. Le dépôt et la notification sont identiques dans les deux cas.
 *
 * Le message est enregistré dans le magasin (la MÊME table que tout le reste) et l'équipe est
 * notifiée sur le site + par e-mail réel si le fournisseur est configuré.
 */
export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";
  const formEncode = contentType.includes("application/x-www-form-urlencoded");
  let brut: Record<string, unknown>;
  if (formEncode) {
    const form = await req.formData();
    brut = Object.fromEntries([...form.entries()].map(([k, v]) => [k, typeof v === "string" ? v : ""]));
  } else {
    try { brut = (await req.json()) as Record<string, unknown>; } catch {
      return NextResponse.json({ erreur: "json_invalide" }, { status: 400 });
    }
  }
  const chaine = (k: string) => (typeof brut[k] === "string" ? (brut[k] as string) : "");
  // La liste des langues vient de lib/i18n (source unique) : jamais de littéral ["fr","en","nl","de"].
  const localeBrute = chaine("locale");
  const locale: Locale = (locales as readonly string[]).includes(localeBrute) ? (localeBrute as Locale) : "fr";
  const magasin = lireMagasin();
  const maintenant = new Date().toISOString();
  const r = deposerMessageContact(magasin, {
    nom: chaine("nom"), email: chaine("email"), sujet: chaine("sujet"), message: chaine("message"),
    // Le formulaire natif envoie « on » pour une case cochée : toute valeur non vide vaut accord,
    // mais un accord explicite est exigé (pas de case pré-cochée).
    consentement: brut.consentement === true || brut.consentement === "on" || brut.consentement === "true",
    locale, maintenant,
  });
  if (!r.message) {
    if (formEncode) return pageErreur(locale, r.erreur ?? "champs_invalides");
    return NextResponse.json({ erreur: r.erreur }, { status: 400 });
  }
  await notifierStaff(magasin, {
    cle: "notifications.contact.nouveau",
    vars: { nom: r.message.nom, sujet: r.message.sujet, ref: r.message.id },
    maintenant,
  });
  ecrireMagasin(magasin);
  if (formEncode) return pageSucces(locale, r.message.id);
  return NextResponse.json({ message: { id: r.message.id, creeA: r.message.creeA } }, { status: 201 });
}

/** GET /api/contact — réservé à l'équipe : la file des messages reçus. */
export async function GET(req: Request) {
  const magasin = lireMagasin();
  const session = verifierSession(magasin, jetonDe(req));
  if (!session) return NextResponse.json({ erreur: "session" }, { status: 401 });
  if (session.role === "CUSTOMER") return NextResponse.json({ erreur: "reserve_staff" }, { status: 403 });
  return NextResponse.json({ messages: messagesContact(magasin) });
}

/** PATCH /api/contact — l'équipe marque un message TRAITE ; le client est notifié (site + e-mail). */
export async function PATCH(req: Request) {
  let corps: Record<string, unknown>;
  try { corps = (await req.json()) as Record<string, unknown>; } catch {
    return NextResponse.json({ erreur: "json_invalide" }, { status: 400 });
  }
  const magasin = lireMagasin();
  const session = verifierSession(magasin, jetonDe(req));
  if (!session) return NextResponse.json({ erreur: "session" }, { status: 401 });
  if (session.role === "CUSTOMER") return NextResponse.json({ erreur: "reserve_staff" }, { status: 403 });
  const maintenant = new Date().toISOString();
  const r = traiterMessageContact(magasin, String(corps.id ?? ""), session.nom, maintenant);
  if (!r.message) return NextResponse.json({ erreur: r.erreur }, { status: r.erreur === "introuvable" ? 404 : 400 });
  await notifierClient(magasin, {
    email: r.message.email, cle: "notifications.contact.traite",
    vars: { sujet: r.message.sujet }, maintenant,
  }, { locale: r.message.locale });
  ecrireMagasin(magasin);
  return NextResponse.json({ message: r.message });
}

/* ——— Réponses HTML du formulaire SANS JavaScript (échappatoire n°2) ——— */

function coquille(locale: Locale, titre: string, corps: string): Response {
  return new Response(
    `<!doctype html><html lang="${locale}"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>${echapper(titre)} — KREDIT</title>` +
      `<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0F1115;color:#fff;` +
      `font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}` +
      `.c{max-width:34rem;padding:2rem;text-align:center}` +
      `a{color:#fff;background:#E8590C;border-radius:999px;padding:.75rem 1.5rem;font-weight:700;text-decoration:none;display:inline-block;margin-top:1.5rem}` +
      `p{color:rgba(255,255,255,.7);line-height:1.6}</style></head><body><div class="c">${corps}</div></body></html>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
}
function pageSucces(locale: Locale, reference: string): Response {
  const titre = t(locale, "contact.sent");
  return coquille(
    locale, titre,
    `<h1>${echapper(titre)}</h1><p>${echapper(t(locale, "contact.reference", { ref: reference }))}</p>` +
      `<p>${echapper(t(locale, "contact.afterNote"))}</p><a href="/${locale}">${echapper(t(locale, "nav.home"))}</a>`,
  );
}
function pageErreur(locale: Locale, erreur: string): Response {
  return coquille(
    locale, t(locale, "contact.title"),
    `<h1>${echapper(t(locale, "contact.title"))}</h1>` +
      `<p>${echapper(t(locale, CLES_ERREUR_CONTACT[erreur] ?? "contact.err.champs"))}</p>` +
      `<a href="/${locale}#contact">${echapper(t(locale, "contact.title"))}</a>`,
  );
}
