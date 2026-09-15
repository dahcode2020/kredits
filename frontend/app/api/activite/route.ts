import { NextResponse } from "next/server";
import { lireMagasin } from "@/lib/serveur";
import { apercuPlateforme, sessionDeRequete } from "@/lib/serveur-banque";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/activite — réservé ADMIN / SUPER_ADMIN : « l'œil de l'administrateur » — totaux en
 *  temps réel (clients, KYC, TOTAL des transactions, volumes, virements, chat borné à une
 *  semaine) + fil des événements récents. Jamais servi à un client. */
export async function GET(req: Request) {
  const magasin = lireMagasin();
  const session = sessionDeRequete(req, magasin);
  if (!session) return NextResponse.json({ erreur: "session" }, { status: 401 });
  if (session.role === "CUSTOMER") return NextResponse.json({ erreur: "reserve_staff" }, { status: 403 });
  const apercu = apercuPlateforme(magasin);
  const docsEnAttente = (magasin.documents ?? []).filter((d) => d.statut === "SOUMIS").length;
  const chargesEnAttente = (magasin.paiements ?? []).filter((p) => p.statut === "EN_ATTENTE").length;
  return NextResponse.json({ ...apercu, docsEnAttente, chargesEnAttente });
}
