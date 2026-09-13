import { NextResponse } from "next/server";
import { NOM_COOKIE, lireMagasin, verifierSession } from "@/lib/serveur";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/auth/session — la session courante (cookie httpOnly), ou { session: null }. */
export async function GET(req: Request) {
  const magasin = lireMagasin();
  const jeton = req.headers.get("cookie")?.split("; ").find((c) => c.startsWith(`${NOM_COOKIE}=`))?.split("=")[1];
  const session = verifierSession(magasin, jeton);
  if (!session) return NextResponse.json({ session: null });
  return NextResponse.json({
    session: { email: session.email, role: session.role, nom: session.nom, ouverteA: session.ouverteA },
  });
}
