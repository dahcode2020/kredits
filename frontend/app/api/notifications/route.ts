import { NextResponse } from "next/server";
import {
  NOM_COOKIE, ecrireMagasin, lireMagasin, mettreAJourPrefsNotif, notificationsPour,
  notifierClient, numeroInternational, verifierSession,
} from "@/lib/serveur";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jetonDe(req: Request): string | undefined {
  return req.headers.get("cookie")?.split("; ").find((c) => c.startsWith(`${NOM_COOKIE}=`))?.split("=")[1];
}

/** GET /api/notifications — les notifications du client connecté (avec l'état réel de chaque
 *  canal de distribution) + ses préférences de distribution. Le personnel lit les siennes
 *  (réponses des clients dans le chat), ou celles d'un compte précis (?compte=email::ROLE). */
export async function GET(req: Request) {
  const magasin = lireMagasin();
  const session = verifierSession(magasin, jetonDe(req));
  if (!session) return NextResponse.json({ erreur: "session" }, { status: 401 });
  if (session.role !== "CUSTOMER") {
    const compte = new URL(req.url).searchParams.get("compte");
    const cible = compte ? compte.split("::")[0] : session.email;
    return NextResponse.json({ notifications: notificationsPour(magasin, cible) });
  }
  const compte = magasin.comptes.find((c) => c.email === session.email && c.role === session.role);
  const numero = compte?.profil?.telephone ? numeroInternational(compte.profil.telephone) : null;
  return NextResponse.json({
    notifications: notificationsPour(magasin, session.email),
    prefs: {
      email: compte?.prefsNotif?.email ?? true,
      whatsapp: compte?.prefsNotif?.whatsapp ?? false,
      numeroWhatsapp: numero,
    },
  });
}

/** POST /api/notifications — deux intentions du client :
 *  - { action: "prefs", email?, whatsapp? } : ses préférences de distribution réelle ;
 *  - { action: "tester" } : une vraie notification de test part sur les canaux configurés. */
export async function POST(req: Request) {
  let corps: Record<string, unknown>;
  try { corps = (await req.json()) as Record<string, unknown>; } catch { return NextResponse.json({ erreur: "json_invalide" }, { status: 400 }); }
  const magasin = lireMagasin();
  const session = verifierSession(magasin, jetonDe(req));
  if (!session) return NextResponse.json({ erreur: "session" }, { status: 401 });
  if (session.role !== "CUSTOMER") return NextResponse.json({ erreur: "reserve_client" }, { status: 403 });
  const maintenant = new Date().toISOString();

  if (corps.action === "prefs") {
    const prefs = mettreAJourPrefsNotif(magasin, session, corps);
    if (!prefs) return NextResponse.json({ erreur: "compte_introuvable" }, { status: 404 });
    ecrireMagasin(magasin);
    return NextResponse.json({ prefs });
  }

  if (corps.action === "tester") {
    const notif = await notifierClient(magasin, { email: session.email, cle: "notifications.testBody", maintenant });
    ecrireMagasin(magasin);
    return NextResponse.json({ notification: notif });
  }

  return NextResponse.json({ erreur: "action_inconnue" }, { status: 400 });
}
