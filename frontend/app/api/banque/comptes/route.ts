import { NextResponse } from "next/server";
import { lireMagasin } from "@/lib/serveur";
import { listeComptesClients, referentielPourApi, sessionDeRequete } from "@/lib/serveur-banque";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/banque/comptes — réservé staff : tous les comptes clients + référentiel effectif. */
export async function GET(req: Request) {
  const magasin = lireMagasin();
  const session = sessionDeRequete(req, magasin);
  if (!session) return NextResponse.json({ erreur: "session" }, { status: 401 });
  if (session.role === "CUSTOMER") return NextResponse.json({ erreur: "reserve_staff" }, { status: 403 });
  return NextResponse.json({ clients: listeComptesClients(magasin), ...referentielPourApi(magasin) });
}
