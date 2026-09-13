import { NextResponse } from "next/server";
import { changerMotDePasse, ecrireMagasin, lireMagasin, verifierSession, NOM_COOKIE } from "@/lib/serveur";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/auth/mdp — changement de mot de passe de la session courante (actuel exigé). */
export async function POST(req: Request) {
  let corps: unknown;
  try { corps = await req.json(); } catch { return NextResponse.json({ erreur: "json_invalide" }, { status: 400 }); }
  const { actuel, nouveau } = (corps ?? {}) as { actuel?: string; nouveau?: string };
  if (typeof actuel !== "string" || typeof nouveau !== "string") {
    return NextResponse.json({ erreur: "champs_manquants" }, { status: 400 });
  }
  const magasin = lireMagasin();
  const jeton = req.headers.get("cookie")?.split("; ").find((c) => c.startsWith(`${NOM_COOKIE}=`))?.split("=")[1];
  const session = verifierSession(magasin, jeton);
  if (!session) return NextResponse.json({ erreur: "session" }, { status: 401 });
  const ok = changerMotDePasse(magasin, session.email, session.role, actuel, nouveau);
  if (!ok) return NextResponse.json({ erreur: "mot_de_passe" }, { status: 400 });
  ecrireMagasin(magasin);
  return NextResponse.json({ ok: true });
}
