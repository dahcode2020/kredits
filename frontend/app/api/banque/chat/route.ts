import { NextResponse } from "next/server";
import { lireMagasin } from "@/lib/serveur";
import { chatPour, sessionDeRequete } from "@/lib/serveur-banque";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/banque/chat — client : sa messagerie ; staff : celle du compte demandé (?compte=…). */
export async function GET(req: Request) {
  const magasin = lireMagasin();
  const session = sessionDeRequete(req, magasin);
  if (!session) return NextResponse.json({ erreur: "session" }, { status: 401 });
  const compteId = new URL(req.url).searchParams.get("compte") ?? undefined;
  const r = chatPour(magasin, session, compteId);
  if ("erreur" in r) return NextResponse.json({ erreur: r.erreur }, { status: r.statut });
  return NextResponse.json(r);
}
