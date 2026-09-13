import { NextResponse } from "next/server";
import { grillePourApi } from "@/lib/serveur";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/grille — la table canonique telle que LE SERVEUR la lit : versions scellées,
 * chaînons validés, règles effectives dérivées par le même moteur que le simulateur.
 */
export async function GET() {
  return NextResponse.json(grillePourApi());
}
