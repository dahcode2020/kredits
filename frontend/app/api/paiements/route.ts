import { NextResponse } from "next/server";
import {
  NOM_COOKIE, confirmerPaiement, creerPaiement, ecrireMagasin, lireMagasin, paiementsPour,
  reglerPaiement, verifierSession, type TypePaiement,
} from "@/lib/serveur";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jetonDe(req: Request): string | undefined {
  return req.headers.get("cookie")?.split("; ").find((c) => c.startsWith(`${NOM_COOKIE}=`))?.split("=")[1];
}

/** GET /api/paiements — le menu Paiements : le client connecté ne voit QUE les siens ;
 *  l'administration voit tout, ou le dossier demandé (?compte=email::ROLE). */
export async function GET(req: Request) {
  const magasin = lireMagasin();
  const session = verifierSession(magasin, jetonDe(req));
  if (!session) return NextResponse.json({ erreur: "session" }, { status: 401 });
  if (session.role !== "CUSTOMER") {
    const compte = new URL(req.url).searchParams.get("compte");
    const paiements = compte ? paiementsPour(magasin, compte.split("::")[0]) : (magasin.paiements ?? []);
    return NextResponse.json({ paiements });
  }
  return NextResponse.json({ paiements: paiementsPour(magasin, session.email) });
}

/** POST /api/paiements — trois intentions :
 *  - client  : { action: "payer", paiementId } → la charge passe en « paiement déclaré » ;
 *  - admin   : { action: "creer", compteId, type, montant, libelle, echeance?, demandeId? }
 *              → nouvelle mensualité / frais, en attente de paiement ;
 *  - admin   : { action: "confirmer", paiementId } → la charge est marquée payée,
 *              le client le constate dans son espace. */
export async function POST(req: Request) {
  let corps: Record<string, unknown>;
  try { corps = (await req.json()) as Record<string, unknown>; } catch { return NextResponse.json({ erreur: "json_invalide" }, { status: 400 }); }
  const magasin = lireMagasin();
  const session = verifierSession(magasin, jetonDe(req));
  if (!session) return NextResponse.json({ erreur: "session" }, { status: 401 });
  const maintenant = new Date().toISOString();

  if (corps.action === "payer") {
    if (session.role !== "CUSTOMER") return NextResponse.json({ erreur: "reserve_client" }, { status: 403 });
    const r = reglerPaiement(magasin, String(corps.paiementId ?? ""), session.email, maintenant);
    if (!r.paiement) return NextResponse.json({ erreur: r.erreur }, { status: 400 });
    ecrireMagasin(magasin);
    return NextResponse.json({ paiement: r.paiement });
  }

  if (session.role === "CUSTOMER") return NextResponse.json({ erreur: "reserve_staff" }, { status: 403 });

  if (corps.action === "creer") {
    const compteId = String(corps.compteId ?? "");
    if (!compteId) return NextResponse.json({ erreur: "champs_manquants" }, { status: 400 });
    const r = creerPaiement(magasin, {
      email: compteId.split("::")[0],
      type: String(corps.type ?? "") as TypePaiement,
      libelle: String(corps.libelle ?? ""),
      montant: Number(corps.montant),
      maintenant,
      echeance: typeof corps.echeance === "string" ? corps.echeance : undefined,
      demandeId: typeof corps.demandeId === "string" ? corps.demandeId : undefined,
    });
    if ("erreur" in r) return NextResponse.json({ erreur: r.erreur }, { status: 400 });
    ecrireMagasin(magasin);
    return NextResponse.json({ paiement: r }, { status: 201 });
  }

  if (corps.action === "confirmer") {
    const r = confirmerPaiement(magasin, String(corps.paiementId ?? ""), maintenant);
    if (!r.paiement) return NextResponse.json({ erreur: r.erreur }, { status: 400 });
    ecrireMagasin(magasin);
    return NextResponse.json({ paiement: r.paiement });
  }

  return NextResponse.json({ erreur: "action_inconnue" }, { status: 400 });
}
