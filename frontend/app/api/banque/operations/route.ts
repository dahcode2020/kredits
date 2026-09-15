import { NextResponse } from "next/server";
import { ecrireMagasin, lireMagasin, notifierClient } from "@/lib/serveur";
import { actionAdmin, sessionDeRequete } from "@/lib/serveur-banque";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/banque/operations — réservé staff : vérifier, créditer, confirmer/bloquer/lever/refuser, chat support. */
export async function POST(req: Request) {
  let corps: Parameters<typeof actionAdmin>[2];
  try { corps = await req.json(); } catch { return NextResponse.json({ erreur: "json_invalide" }, { status: 400 }); }
  const magasin = lireMagasin();
  const session = sessionDeRequete(req, magasin);
  if (!session) return NextResponse.json({ erreur: "session" }, { status: 401 });
  const r = actionAdmin(magasin, session, corps);
  // Notification IMPORTANTE : un virement entrant crédité par l'administration (site + e-mail + WhatsApp).
  if (r.modifie && corps.action === "crediter" && typeof corps.compteId === "string") {
    await notifierClient(magasin, {
      email: corps.compteId.split("::")[0], cle: "banque.notify.credit",
      vars: { montant: `${Number(corps.montant).toFixed(2)} €` }, maintenant: new Date().toISOString(),
    });
  }
  if (r.modifie) ecrireMagasin(magasin);
  return NextResponse.json(r.corps, { status: r.statut });
}
