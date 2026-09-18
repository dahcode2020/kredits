import { NextResponse } from "next/server";
import { ecrireMagasin, lireMagasin } from "@/lib/serveur";
import { avancerEtNotifier, listeComptesClients, notifierEvenementsPipeline, referentielPourApi, sessionDeRequete } from "@/lib/serveur-banque";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/banque/comptes — réservé staff : tous les comptes clients + référentiel effectif.
 *  La progression en direct avance pour CHAQUE client avant l'affichage : l'administration voit
 *  toujours l'état réel à l'instant de la lecture. */
export async function GET(req: Request) {
  const magasin = lireMagasin();
  const session = sessionDeRequete(req, magasin);
  if (!session) return NextResponse.json({ erreur: "session" }, { status: 401 });
  if (session.role === "CUSTOMER") return NextResponse.json({ erreur: "reserve_staff" }, { status: 403 });
  const maintenant = new Date().toISOString();
  let avance = false;
  for (const c of magasin.comptes.filter((x) => x.role === "CUSTOMER")) {
    const evenements = avancerEtNotifier(magasin, c.email, c.role, maintenant);
    if (evenements.length === 0) continue;
    avance = true;
    await notifierEvenementsPipeline(magasin, c.email, evenements, maintenant);
  }
  if (avance) ecrireMagasin(magasin);
  return NextResponse.json({ clients: listeComptesClients(magasin), ...referentielPourApi(magasin) });
}
