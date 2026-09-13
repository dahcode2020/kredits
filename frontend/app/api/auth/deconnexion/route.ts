import { NextResponse } from "next/server";
import { NOM_COOKIE, ecrireMagasin, lireMagasin, revoquerSession } from "@/lib/serveur";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/auth/deconnexion — révoque la session serveur et efface le cookie. */
export async function POST(req: Request) {
  const magasin = lireMagasin();
  const jeton = req.headers.get("cookie")?.split("; ").find((c) => c.startsWith(`${NOM_COOKIE}=`))?.split("=")[1];
  revoquerSession(magasin, jeton);
  ecrireMagasin(magasin);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(NOM_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
