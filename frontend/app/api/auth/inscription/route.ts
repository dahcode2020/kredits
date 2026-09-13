import { NextResponse } from "next/server";
import {
  NOM_COOKIE, creerCompte, ecrireMagasin, lireMagasin, ouvrirSessionServeur, optionsCookie,
} from "@/lib/serveur";
import { ouvrirBanquePour } from "@/lib/serveur-banque";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/auth/inscription — crée le compte serveur (scrypt salé) et ouvre la session. */
export async function POST(req: Request) {
  let corps: unknown;
  try { corps = await req.json(); } catch { return NextResponse.json({ erreur: "json_invalide" }, { status: 400 }); }
  const { email, motDePasse, nom, profil } = (corps ?? {}) as { email?: string; motDePasse?: string; nom?: string; profil?: Record<string, string> };
  if (typeof email !== "string" || typeof motDePasse !== "string" || typeof nom !== "string") {
    return NextResponse.json({ erreur: "champs_manquants" }, { status: 400 });
  }
  const magasin = lireMagasin();
  const compte = creerCompte(magasin, { email, motDePasse, role: "CUSTOMER", nom, profil });
  if ("erreur" in compte) {
    return NextResponse.json({ erreur: compte.erreur }, { status: compte.erreur === "existant" ? 409 : 400 });
  }
  const session = ouvrirSessionServeur(magasin, compte);
  // La banque du client naît côté serveur : IBAN fictif déterministe + dotation de démonstration.
  ouvrirBanquePour(magasin, compte.email, compte.role, session.ouverteA);
  ecrireMagasin(magasin);
  const res = NextResponse.json({ email: compte.email, role: compte.role, nom: compte.nom, ouverteA: session.ouverteA }, { status: 201 });
  res.cookies.set(NOM_COOKIE, session.jeton, optionsCookie(process.env.NODE_ENV === "production"));
  return res;
}
