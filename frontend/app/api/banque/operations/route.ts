import { NextResponse } from "next/server";
import { ecrireMagasin, lireMagasin } from "@/lib/serveur";
import { actionAdmin, sessionDeRequete } from "@/lib/serveur-banque";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/banque/operations — réservé staff : vérifier, créditer, confirmer/bloquer/lever/refuser, chat support. */
export async function POST(req: Request) {
  let corps: Parameters<typeof actionAdmin>[2];
  try { corps = await req.json(); } catch { return NextResponse.json({ erreur: "json_invalide" }, { status: 400 }); }
  const magasin = lireMagasin();
  const session = sessionDeRequete(req, magasin);
  if (!session) return NextResponse.json({ erreur: "session" }, { status: 401 });
  const r = actionAdmin(magasin, session, corps);
  if (r.modifie) ecrireMagasin(magasin);
  return NextResponse.json(r.corps, { status: r.statut });
}
