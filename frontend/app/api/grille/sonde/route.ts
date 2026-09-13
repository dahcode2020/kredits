import { NextResponse } from "next/server";
import { sondeGrillePourApi } from "@/lib/serveur";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/grille/sonde?date=AAAA-MM-JJ — la version de grille applicable à cette date. */
export async function GET(req: Request) {
  const date = new URL(req.url).searchParams.get("date") ?? "";
  const sonde = sondeGrillePourApi(date);
  if (!sonde) return NextResponse.json({ erreur: "date_invalide" }, { status: 400 });
  return NextResponse.json(sonde);
}
