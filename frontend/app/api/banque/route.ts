import { NextResponse } from "next/server";
import { ecrireMagasin, lireMagasin } from "@/lib/serveur";
import { actionClient, banqueDeSession, sessionDeRequete } from "@/lib/serveur-banque";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/banque — le compte bancaire du client connecté (ouvert à la volée) + référentiel. */
export async function GET(req: Request) {
  const magasin = lireMagasin();
  const session = sessionDeRequete(req, magasin);
  if (!session) return NextResponse.json({ erreur: "session" }, { status: 401 });
  const r = banqueDeSession(magasin, session);
  if ("erreur" in r) return NextResponse.json({ erreur: r.erreur }, { status: r.statut });
  ecrireMagasin(magasin); // l'ouverture à la volée est persistée
  return NextResponse.json(r);
}

/** POST /api/banque — intentions du client : virement, annuler, chat, photo. */
export async function POST(req: Request) {
  let corps: Parameters<typeof actionClient>[2];
  try { corps = await req.json(); } catch { return NextResponse.json({ erreur: "json_invalide" }, { status: 400 }); }
  const magasin = lireMagasin();
  const session = sessionDeRequete(req, magasin);
  if (!session) return NextResponse.json({ erreur: "session" }, { status: 401 });
  const r = actionClient(magasin, session, corps);
  if (r.modifie) ecrireMagasin(magasin);
  return NextResponse.json(r.corps, { status: r.statut });
}
