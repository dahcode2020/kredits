import { NextResponse } from "next/server";
import { NOM_COOKIE, ecrireMagasin, lireMagasin, mettreAJourProfilServeur, verifierSession } from "@/lib/serveur";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/auth/profil — le client met à jour SES champs éditables (adresse, téléphone,
 *  situation) ; liste blanche côté serveur, le reste (identité, KYC) passe par l'administration. */
export async function POST(req: Request) {
  let corps: unknown;
  try { corps = await req.json(); } catch { return NextResponse.json({ erreur: "json_invalide" }, { status: 400 }); }
  if (typeof corps !== "object" || corps === null) return NextResponse.json({ erreur: "champs_manquants" }, { status: 400 });
  const magasin = lireMagasin();
  const jeton = req.headers.get("cookie")?.split("; ").find((c) => c.startsWith(`${NOM_COOKIE}=`))?.split("=")[1];
  const session = verifierSession(magasin, jeton);
  if (!session) return NextResponse.json({ erreur: "session" }, { status: 401 });
  const profil = mettreAJourProfilServeur(magasin, session, corps as Record<string, unknown>);
  if (!profil) return NextResponse.json({ erreur: "compte_introuvable" }, { status: 404 });
  ecrireMagasin(magasin);
  return NextResponse.json({ profil });
}
