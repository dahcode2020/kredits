import { NextResponse } from "next/server";
import { simulerServeur } from "@/lib/serveur";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INCOME = ["SALARY", "SELF_EMPLOYED", "PENSION", "UNEMPLOYMENT", "OTHER"];
const EMPLOI = ["CDI", "CDD", "INDEPENDENT", "INTERIM", "RETIRED", "STUDENT", "UNEMPLOYED"];
const OBJET = ["VEHICLE", "WORKS", "CONSUMPTION", "DEBT_CONSOLIDATION", "MEDICAL", "OTHER"];

/**
 * POST /api/simuler — simulation côté serveur avec la même table canonique ; la réponse scelle
 * rateRuleId + grilleVersion (piste d'audit).
 */
export async function POST(req: Request) {
  let corps: unknown;
  try { corps = await req.json(); } catch { return NextResponse.json({ erreur: "json_invalide" }, { status: 400 }); }
  const c = (corps ?? {}) as Record<string, unknown>;
  const nombre = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const amount = nombre(c.amount);
  const termMonths = nombre(c.termMonths);
  const monthlyIncome = nombre(c.monthlyIncome);
  const monthlyCharges = nombre(c.monthlyCharges) ?? 0;
  if (amount === null || termMonths === null || monthlyIncome === null) {
    return NextResponse.json({ erreur: "champs_manquants" }, { status: 400 });
  }
  if (typeof c.incomeType !== "string" || !INCOME.includes(c.incomeType)
    || typeof c.employmentStatus !== "string" || !EMPLOI.includes(c.employmentStatus)
    || typeof c.loanPurpose !== "string" || !OBJET.includes(c.loanPurpose)) {
    return NextResponse.json({ erreur: "champs_manquants" }, { status: 400 });
  }
  try {
    const resultat = simulerServeur({
      amount, termMonths, monthlyIncome, monthlyCharges,
      incomeType: c.incomeType as never, employmentStatus: c.employmentStatus as never, loanPurpose: c.loanPurpose as never,
      existingCreditsMonthly: nombre(c.existingCreditsMonthly ?? 0) ?? 0,
      country: typeof c.country === "string" ? c.country : "BE",
      productType: typeof c.productType === "string" ? c.productType : undefined,
    });
    return NextResponse.json(resultat);
  } catch {
    return NextResponse.json({ erreur: "aucune_grille" }, { status: 422 });
  }
}
