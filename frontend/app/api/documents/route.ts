import { NextResponse } from "next/server";
import {
  NOM_COOKIE, approuverDocument, deposerDocument, documentsPour, ecrireMagasin, lireMagasin,
  verifierSession,
} from "@/lib/serveur";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jetonDe(req: Request): string | undefined {
  return req.headers.get("cookie")?.split("; ").find((c) => c.startsWith(`${NOM_COOKIE}=`))?.split("=")[1];
}

/** GET /api/documents — le client connecté ne voit QUE les siens ; l'administration voit
 *  tout, ou le dossier demandé (?compte=email::ROLE). Les données (dataURL) voyagent : c'est
 *  ce qui permet à l'admin d'OUVRIR la pièce déposée. */
export async function GET(req: Request) {
  const magasin = lireMagasin();
  const session = verifierSession(magasin, jetonDe(req));
  if (!session) return NextResponse.json({ erreur: "session" }, { status: 401 });
  if (session.role !== "CUSTOMER") {
    const compte = new URL(req.url).searchParams.get("compte");
    const documents = compte ? documentsPour(magasin, compte.split("::")[0]) : (magasin.documents ?? []);
    return NextResponse.json({ documents });
  }
  return NextResponse.json({ documents: documentsPour(magasin, session.email) });
}

/** POST /api/documents — deux intentions :
 *  - client : { action: "deposer", demandeId, code, nom, donnees, taille } → pièce SOUMISE ;
 *  - admin  : { action: "approuver", documentId } → APPROUVÉE + notification au client. */
export async function POST(req: Request) {
  let corps: Record<string, unknown>;
  try { corps = (await req.json()) as Record<string, unknown>; } catch { return NextResponse.json({ erreur: "json_invalide" }, { status: 400 }); }
  const magasin = lireMagasin();
  const session = verifierSession(magasin, jetonDe(req));
  if (!session) return NextResponse.json({ erreur: "session" }, { status: 401 });
  const maintenant = new Date().toISOString();

  if (corps.action === "deposer") {
    if (session.role !== "CUSTOMER") return NextResponse.json({ erreur: "reserve_client" }, { status: 403 });
    const r = deposerDocument(magasin, {
      email: session.email,
      demandeId: String(corps.demandeId ?? ""),
      code: String(corps.code ?? ""),
      nom: String(corps.nom ?? ""),
      donnees: String(corps.donnees ?? ""),
      taille: Number(corps.taille),
      maintenant,
    });
    if (!r.document) return NextResponse.json({ erreur: r.erreur }, { status: 400 });
    ecrireMagasin(magasin);
    return NextResponse.json({ document: r.document }, { status: 201 });
  }

  if (session.role === "CUSTOMER") return NextResponse.json({ erreur: "reserve_staff" }, { status: 403 });

  if (corps.action === "approuver") {
    const r = approuverDocument(magasin, String(corps.documentId ?? ""), session.nom, maintenant);
    if (!r.document) return NextResponse.json({ erreur: r.erreur }, { status: 400 });
    ecrireMagasin(magasin);
    return NextResponse.json({ document: r.document });
  }

  return NextResponse.json({ erreur: "action_inconnue" }, { status: 400 });
}
