import { NextResponse } from "next/server";
import { ecrireMagasin, lireMagasin } from "@/lib/serveur";
import { referentielPourApi, sessionDeRequete, surchargerReferentiel } from "@/lib/serveur-banque";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/banque/referentiel — le référentiel canonique + les surcharges serveur. */
export async function GET(req: Request) {
  const magasin = lireMagasin();
  const session = sessionDeRequete(req, magasin);
  if (!session) return NextResponse.json({ erreur: "session" }, { status: 401 });
  return NextResponse.json(referentielPourApi(magasin));
}

/** POST /api/banque/referentiel — réservé staff : coût / activation d'un défaut. */
export async function POST(req: Request) {
  let corps: { code?: string; cout?: number; actif?: boolean };
  try { corps = await req.json(); } catch { return NextResponse.json({ erreur: "json_invalide" }, { status: 400 }); }
  const magasin = lireMagasin();
  const session = sessionDeRequete(req, magasin);
  if (!session) return NextResponse.json({ erreur: "session" }, { status: 401 });
  const r = surchargerReferentiel(magasin, session, corps);
  if (r.statut === 200) ecrireMagasin(magasin);
  return NextResponse.json(r.corps, { status: r.statut });
}
