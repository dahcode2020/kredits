import { NextResponse } from "next/server";
import { ecrireMagasin, lireMagasin, notifierStaff } from "@/lib/serveur";
import { actionClient, avancerEtNotifier, banqueDeSession, notifierEvenementsPipeline, sessionDeRequete } from "@/lib/serveur-banque";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/banque — le compte bancaire du client connecté (ouvert à la volée) + référentiel.
 *  La progression en direct avance à CHAQUE lecture : les paliers dont l'échéance est passée
 *  sont confirmés ici, et chaque événement devient une notification au client. */
export async function GET(req: Request) {
  const magasin = lireMagasin();
  const session = sessionDeRequete(req, magasin);
  if (!session) return NextResponse.json({ erreur: "session" }, { status: 401 });
  const maintenant = new Date().toISOString();
  const evenements = avancerEtNotifier(magasin, session.email, session.role, maintenant);
  const r = banqueDeSession(magasin, session);
  if ("erreur" in r) return NextResponse.json({ erreur: r.erreur }, { status: r.statut });
  if (evenements.length > 0) await notifierEvenementsPipeline(magasin, session.email, evenements, maintenant);
  ecrireMagasin(magasin); // l'ouverture à la volée et la progression sont persistées
  return NextResponse.json(r);
}

/** POST /api/banque — intentions du client : virement, annuler, debloquer, chat, photo. */
export async function POST(req: Request) {
  let corps: Parameters<typeof actionClient>[2];
  try { corps = await req.json(); } catch { return NextResponse.json({ erreur: "json_invalide" }, { status: 400 }); }
  const magasin = lireMagasin();
  const session = sessionDeRequete(req, magasin);
  if (!session) return NextResponse.json({ erreur: "session" }, { status: 401 });
  const maintenant = new Date().toISOString();
  const evenements = avancerEtNotifier(magasin, session.email, session.role, maintenant);
  const r = actionClient(magasin, session, corps);
  // Réponse du client dans le chat → l'équipe est prévenue (site + e-mail réel).
  if (r.modifie && corps.action === "chat") {
    await notifierStaff(magasin, { cle: "notifications.chat.fromClient", vars: { client: session.nom }, maintenant: new Date().toISOString() });
  }
  if (evenements.length > 0) await notifierEvenementsPipeline(magasin, session.email, evenements, maintenant);
  if (r.modifie || evenements.length > 0) ecrireMagasin(magasin);
  return NextResponse.json(r.corps, { status: r.statut });
}
