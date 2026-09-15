import { NextResponse } from "next/server";
import {
  NOM_COOKIE, contratsPour, creerContrat, ecrireMagasin, lireMagasin, majContrat,
  notifierClient, notifierContrat, verifierSession,
} from "@/lib/serveur";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jetonDe(req: Request): string | undefined {
  return req.headers.get("cookie")?.split("; ").find((c) => c.startsWith(`${NOM_COOKIE}=`))?.split("=")[1];
}

/** GET /api/contrats — le client connecté ne voit QUE ses contrats ; l'administration voit
 *  tout, ou le dossier demandé (?compte=email::ROLE). */
export async function GET(req: Request) {
  const magasin = lireMagasin();
  const session = verifierSession(magasin, jetonDe(req));
  if (!session) return NextResponse.json({ erreur: "session" }, { status: 401 });
  if (session.role !== "CUSTOMER") {
    const compte = new URL(req.url).searchParams.get("compte");
    const contrats = compte ? contratsPour(magasin, compte.split("::")[0]) : (magasin.contrats ?? []);
    return NextResponse.json({ contrats });
  }
  return NextResponse.json({ contrats: contratsPour(magasin, session.email) });
}

/** POST /api/contrats — réservé à l'administration :
 *  - { action: "creer", compteId, objet, montant, dureeMois, tauxAnnuel, mentions?, demandeId? }
 *    → contrat BROUILLON, mensualité calculée par le serveur ;
 *  - { action: "maj", contratId, objet?, montant?, dureeMois?, tauxAnnuel?, mentions? }
 *    → mise à jour, mensualité recalculée ;
 *  - { action: "notifier", contratId } → le contrat passe NOTIFIE et le client est prévenu
 *    sur les canaux réels (site + e-mail + WhatsApp selon ses préférences). */
export async function POST(req: Request) {
  let corps: Record<string, unknown>;
  try { corps = (await req.json()) as Record<string, unknown>; } catch { return NextResponse.json({ erreur: "json_invalide" }, { status: 400 }); }
  const magasin = lireMagasin();
  const session = verifierSession(magasin, jetonDe(req));
  if (!session) return NextResponse.json({ erreur: "session" }, { status: 401 });
  if (session.role === "CUSTOMER") return NextResponse.json({ erreur: "reserve_staff" }, { status: 403 });
  const maintenant = new Date().toISOString();

  if (corps.action === "creer") {
    const compteId = String(corps.compteId ?? "");
    if (!compteId) return NextResponse.json({ erreur: "champs_manquants" }, { status: 400 });
    const r = creerContrat(magasin, {
      email: compteId.split("::")[0],
      objet: String(corps.objet ?? ""),
      montant: Number(corps.montant),
      dureeMois: Number(corps.dureeMois),
      tauxAnnuel: Number(corps.tauxAnnuel),
      mentions: corps.mentions,
      demandeId: typeof corps.demandeId === "string" ? corps.demandeId : undefined,
      maintenant,
    });
    if (!r.contrat) return NextResponse.json({ erreur: r.erreur }, { status: 400 });
    ecrireMagasin(magasin);
    return NextResponse.json({ contrat: r.contrat }, { status: 201 });
  }

  if (corps.action === "maj") {
    const r = majContrat(magasin, String(corps.contratId ?? ""), maintenant, {
      objet: corps.objet, montant: corps.montant, dureeMois: corps.dureeMois,
      tauxAnnuel: corps.tauxAnnuel, mentions: corps.mentions,
    });
    if (!r.contrat) return NextResponse.json({ erreur: r.erreur }, { status: 400 });
    ecrireMagasin(magasin);
    return NextResponse.json({ contrat: r.contrat });
  }

  if (corps.action === "notifier") {
    const avant = (magasin.contrats ?? []).find((c) => c.id === String(corps.contratId ?? ""));
    if (!avant) return NextResponse.json({ erreur: "introuvable" }, { status: 400 });
    const statutAvant = avant.statut; // capturé AVANT la mutation (même objet en mémoire)
    const r = notifierContrat(magasin, avant.id, maintenant);
    if (!r.contrat) return NextResponse.json({ erreur: r.erreur }, { status: 400 });
    const neuf = r.contrat;
    // Notification IMPORTANTE : le contrat est transmis au client (site + e-mail + WhatsApp).
    const premiere = statutAvant === "BROUILLON";
    await notifierClient(magasin, {
      email: neuf.email,
      cle: premiere ? "dashboard.contracts.notify.new" : "dashboard.contracts.notify.updated",
      vars: { montant: `${neuf.montant.toFixed(2)} €`, mensualite: `${neuf.mensualite.toFixed(2)} €` },
      maintenant,
    });
    ecrireMagasin(magasin);
    return NextResponse.json({ contrat: neuf });
  }

  return NextResponse.json({ erreur: "action_inconnue" }, { status: 400 });
}
