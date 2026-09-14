import { NextResponse } from "next/server";
import { NOM_COOKIE, lireMagasin, notificationsPour, verifierSession } from "@/lib/serveur";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/notifications — les notifications du client connecté (ex. document approuvé) ;
 *  l'administration peut lire celles d'un compte (?compte=email::ROLE). */
export async function GET(req: Request) {
  const magasin = lireMagasin();
  const jeton = req.headers.get("cookie")?.split("; ").find((c) => c.startsWith(`${NOM_COOKIE}=`))?.split("=")[1];
  const session = verifierSession(magasin, jeton);
  if (!session) return NextResponse.json({ erreur: "session" }, { status: 401 });
  if (session.role !== "CUSTOMER") {
    const compte = new URL(req.url).searchParams.get("compte");
    if (!compte) return NextResponse.json({ erreur: "champs_manquants" }, { status: 400 });
    return NextResponse.json({ notifications: notificationsPour(magasin, compte.split("::")[0]) });
  }
  return NextResponse.json({ notifications: notificationsPour(magasin, session.email) });
}
