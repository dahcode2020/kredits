import { NextResponse } from "next/server";
import { etatDepuisQuery, nouvelleReference, type EtatSimulation } from "@/lib/application";
import {
  NOM_COOKIE, deposerDemandeServeur, demandesPour, ecrireMagasin, lireMagasin, verifierSession,
  type DemandeServeur,
} from "@/lib/serveur";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jetonDe(req: Request): string | undefined {
  return req.headers.get("cookie")?.split("; ").find((c) => c.startsWith(`${NOM_COOKIE}=`))?.split("=")[1];
}

/** GET /api/demandes — l'aperçu des demandes en cours : le client connecté ne voit QUE les
 *  siennes ; l'administration voit celles du compte demandé (?compte=), sinon toutes. */
export async function GET(req: Request) {
  const magasin = lireMagasin();
  const session = verifierSession(magasin, jetonDe(req));
  if (!session) return NextResponse.json({ erreur: "session" }, { status: 401 });
  if (session.role !== "CUSTOMER") {
    const compte = new URL(req.url).searchParams.get("compte");
    const demandes = compte ? demandesPour(magasin, compte) : (magasin.demandes ?? []);
    return NextResponse.json({ demandes });
  }
  return NextResponse.json({ demandes: demandesPour(magasin, session.email) });
}

/** POST /api/demandes — dépôt d'une demande : l'état de simulation est VALIDÉ et borné par la
 *  même fonction d'entrée que l'URL du simulateur (rien ne peut passer hors grille). La demande
 *  est rattachée au compte de la session, pas à un email saisi librement. */
export async function POST(req: Request) {
  let corps: unknown;
  try { corps = await req.json(); } catch { return NextResponse.json({ erreur: "json_invalide" }, { status: 400 }); }
  if (typeof corps !== "object" || corps === null) return NextResponse.json({ erreur: "corps_invalide" }, { status: 400 });
  const magasin = lireMagasin();
  const session = verifierSession(magasin, jetonDe(req));
  if (!session) return NextResponse.json({ erreur: "session" }, { status: 401 });
  const brut = corps as Record<string, unknown>;
  const champs: Record<string, string | undefined> = {};
  for (const k of ["product", "amount", "term", "income", "charges", "existing", "incomeType", "employment", "purpose", "nom", "telephone"]) {
    const v = brut[k];
    champs[k] = typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : undefined;
  }
  const etat: EtatSimulation = etatDepuisQuery({
    p: champs.product, a: champs.amount, t: champs.term, inc: champs.income,
    chg: champs.charges, ex: champs.existing, it: champs.incomeType, em: champs.employment, lp: champs.purpose,
  });
  const demande: DemandeServeur = {
    id: nouvelleReference(new Date()),
    email: session.email,
    nom: (champs.nom ?? session.nom).trim().slice(0, 120) || session.nom,
    telephone: (champs.telephone ?? "").trim().slice(0, 40),
    creeA: new Date().toISOString(),
    statut: "SUBMITTED",
    etat,
  };
  deposerDemandeServeur(magasin, demande);
  ecrireMagasin(magasin);
  return NextResponse.json({ demande }, { status: 201 });
}
