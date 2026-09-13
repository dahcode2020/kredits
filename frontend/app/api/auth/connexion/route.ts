import { NextResponse } from "next/server";
import {
  NOM_COOKIE, ecrireMagasin, lireMagasin, ouvrirSessionServeur, optionsCookie, trouverCompte,
  verifierMotDePasse, type RoleServeur,
} from "@/lib/serveur";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/auth/connexion — vérifie le mot de passe (scrypt) et ouvre la session. */
export async function POST(req: Request) {
  let corps: unknown;
  try { corps = await req.json(); } catch { return NextResponse.json({ erreur: "json_invalide" }, { status: 400 }); }
  const { email, motDePasse, role } = (corps ?? {}) as { email?: string; motDePasse?: string; role?: RoleServeur };
  if (typeof email !== "string" || typeof motDePasse !== "string") {
    return NextResponse.json({ erreur: "champs_manquants" }, { status: 400 });
  }
  const magasin = lireMagasin();
  const compte = trouverCompte(magasin, email, role ?? "CUSTOMER");
  if (!compte || !verifierMotDePasse(motDePasse, compte.sel, compte.hash)) {
    return NextResponse.json({ erreur: "identifiants" }, { status: 401 });
  }
  const session = ouvrirSessionServeur(magasin, compte);
  ecrireMagasin(magasin);
  const res = NextResponse.json({ email: compte.email, role: compte.role, nom: compte.nom, ouverteA: session.ouverteA });
  res.cookies.set(NOM_COOKIE, session.jeton, optionsCookie(process.env.NODE_ENV === "production"));
  return res;
}
