"use client";
/**
 * « use client » : l'état du formulaire vit ici ; le composant reste rendu par le serveur (SSR)
 * avec la simulation par défaut — aucune API navigateur au render, état initial déterministe
 * (mêmes entrées → mêmes sorties côté serveur et côté client), formatters Intl normalisés :
 * le contrat d'hydratation tient (docs/hydration.md).
 *
 * Règles héritées du brief, appliquées à la lettre :
 * - chaque nombre affiché sort de simulateCredit() (lib/credit-engine.ts) ; les champs `message`
 *   du moteur (français, format backend) ne sont JAMAIS rendus — l'UI interpole les clés
 *   `credit:simulator.warning.*` avec des valeurs reformatées par locale ;
 * - chaque libellé vient des dictionnaires, via des clés STATIQUES (le scan de parité doit les
 *   voir ; les codes produit/revenu/statut/objet/alerte/document passent par des tables de clés
 *   littérales, jamais par concaténation) ;
 * - pas de bouton « Déposer ma demande » : la destination (slice 3) n'existe pas encore.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Calculator, FileText, Gauge, ShieldAlert } from "lucide-react";
import Reveal from "@/components/motion/Reveal";
import CountUp from "@/components/motion/CountUp";
import { buttonClasses } from "@/components/ui/Button";
import { formatCurrency0, formatPercent } from "@/lib/formatters";
import { formatEUR2 } from "@/lib/utils";
import { Locale, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  EMPLOYMENT_STATUSES, INCOME_TYPES, LOAN_PURPOSES, PRODUITS, PRODUCT_TYPES,
  SIMULATION_WARNINGS, DOCUMENT_CODES, simulateCredit,
  type EmploymentStatus, type IncomeType, type LoanPurpose, type ProductCode,
} from "@/lib/credit-engine";

/* Tables de clés littérales : le scan i18n voit chaque clé, et un code sans clé casse le type. */
const CLES_TAB: Record<ProductCode, string> = {
  PERSONAL: "credit:simulator.tab.PERSONAL",
  MORTGAGE: "credit:simulator.tab.MORTGAGE",
  BUSINESS: "credit:simulator.tab.BUSINESS",
  INVESTMENT: "credit:simulator.tab.INVESTMENT",
};
const CLES_REVENU: Record<IncomeType, string> = {
  SALARY: "credit:simulator.incomeType.SALARY",
  SELF_EMPLOYED: "credit:simulator.incomeType.SELF_EMPLOYED",
  PENSION: "credit:simulator.incomeType.PENSION",
  UNEMPLOYMENT: "credit:simulator.incomeType.UNEMPLOYMENT",
  OTHER: "credit:simulator.incomeType.OTHER",
};
const CLES_EMPLOI: Record<EmploymentStatus, string> = {
  CDI: "credit:simulator.employment.CDI",
  CDD: "credit:simulator.employment.CDD",
  INDEPENDENT: "credit:simulator.employment.INDEPENDENT",
  INTERIM: "credit:simulator.employment.INTERIM",
  RETIRED: "credit:simulator.employment.RETIRED",
  STUDENT: "credit:simulator.employment.STUDENT",
  UNEMPLOYED: "credit:simulator.employment.UNEMPLOYED",
};
const CLES_OBJET: Record<LoanPurpose, string> = {
  VEHICLE: "credit:simulator.purpose.VEHICLE",
  WORKS: "credit:simulator.purpose.WORKS",
  CONSUMPTION: "credit:simulator.purpose.CONSUMPTION",
  DEBT_CONSOLIDATION: "credit:simulator.purpose.DEBT_CONSOLIDATION",
  MEDICAL: "credit:simulator.purpose.MEDICAL",
  OTHER: "credit:simulator.purpose.OTHER",
};
const CLES_ALERTE: Record<(typeof SIMULATION_WARNINGS)[number], string> = {
  DEBT_RATIO_HIGH: "credit:simulator.warning.DEBT_RATIO_HIGH",
  OVER_INDEBTED: "credit:simulator.warning.OVER_INDEBTED",
  LOW_CAPACITY: "credit:simulator.warning.LOW_CAPACITY",
  AT_CEILING: "credit:simulator.warning.AT_CEILING",
};
const CLES_DOC: Record<(typeof DOCUMENT_CODES)[number], string> = {
  ID: "credit:documents.ID",
  INCOME_3M: "credit:documents.INCOME_3M",
  PROOF_ADDRESS: "credit:documents.PROOF_ADDRESS",
  PROPERTY_VALUATION: "credit:documents.PROPERTY_VALUATION",
  BANK_STATEMENTS_3M: "credit:documents.BANK_STATEMENTS_3M",
  TAX_RETURN_2Y: "credit:documents.TAX_RETURN_2Y",
  BUSINESS_PLAN: "credit:documents.BUSINESS_PLAN",
};
const CLES_FACTEUR: Record<string, string> = {
  debtRatio: "credit:simulator.scoreFactor.debtRatio",
  incomeStability: "credit:simulator.scoreFactor.incomeStability",
  employment: "credit:simulator.scoreFactor.employment",
  purpose: "credit:simulator.scoreFactor.purpose",
  term: "credit:simulator.scoreFactor.term",
};

/* L'exemple du dictionnaire (heroCard.example) : 15 000 € / 48 mois. État initial déterministe,
   identique serveur et client. */
const DEFAUT = {
  product: "PERSONAL" as ProductCode,
  amount: 15_000,
  term: 48,
  income: 3_200,
  charges: 600,
  existing: 0,
  incomeType: "SALARY" as IncomeType,
  employment: "CDI" as EmploymentStatus,
  purpose: "CONSUMPTION" as LoanPurpose,
};

const MOIS_AFFICHES = 12;

function borne(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

export default function SimulatorPage({ locale }: { locale: Locale }) {
  const tr = (k: string, vars?: Record<string, string>) => t(locale, k, vars);
  const [etat, setEtat] = useState(DEFAUT);

  const produit = PRODUITS[etat.product];

  const changerProduit = (code: ProductCode) => {
    const p = PRODUITS[code];
    setEtat((e) => ({
      ...e,
      product: code,
      amount: borne(Math.round(e.amount / p.pas) * p.pas || p.min, p.min, p.max),
      term: borne(e.term, p.minTerm, p.maxTerm),
    }));
  };

  const simulation = useMemo(
    () =>
      simulateCredit({
        amount: etat.amount,
        termMonths: etat.term,
        monthlyIncome: etat.income,
        monthlyCharges: etat.charges,
        incomeType: etat.incomeType,
        employmentStatus: etat.employment,
        loanPurpose: etat.purpose,
        existingCreditsMonthly: etat.existing,
        country: "BE",
        productType: etat.product,
      }),
    [etat],
  );
  const { monthlyPayment, taeg, totalCost, totalInterest, fees, schedule, meta } = simulation.simulation;
  const ratio = simulation.eligibility.debtRatio;
  const ratioFin = Number.isFinite(ratio);

  const mensualiteFinale = formatEUR2(monthlyPayment, locale);
  const plafondPct = formatPercent(etat.amount / PRODUITS[meta.product].max, locale, 0);

  const variablesAlerte = (code: (typeof SIMULATION_WARNINGS)[number]): Record<string, string> => {
    switch (code) {
      case "DEBT_RATIO_HIGH":
      case "OVER_INDEBTED":
        return { pct: ratioFin ? formatPercent(ratio, locale, 1) : "∞" };
      case "LOW_CAPACITY":
        return { capacity: formatCurrency0(simulation.eligibility.repaymentCapacity, locale) };
      case "AT_CEILING":
        return { pct: plafondPct };
    }
  };

  return (
    <div className="bg-surface">
      {/* Bandeau titre — même langue visuelle que le hero (maillage + encre). */}
      <section className="relative overflow-hidden bg-ink">
        <div className="maillage" aria-hidden="true" />
        <div className="relative mx-auto max-w-[1280px] px-6 py-12 md:py-16">
          <Reveal as="div" variant="fade" className="flex flex-wrap items-center gap-3">
            <Link href={`/${locale}`} className={buttonClasses("outline", "md", "gap-2")}>
              <ArrowLeft className="w-4 h-4" aria-hidden="true" /> {tr("action.back")}
            </Link>
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/15 text-[11px] tracking-widest uppercase font-bold text-white/90">
              <Calculator className="w-3.5 h-3.5 text-primary" aria-hidden="true" /> {tr("credit:simulator.badge")}
            </span>
          </Reveal>
          <Reveal as="h1" retard={90} className="mt-5 font-display font-extrabold text-white text-[36px] md:text-[46px] leading-[1.02] tracking-tight">
            {tr("credit:simulator.title")}
          </Reveal>
          <Reveal as="p" retard={160} className="mt-3 text-[15px] leading-7 text-white/70 max-w-[640px]">
            {tr("credit:simulator.subtitle")}
          </Reveal>
        </div>
      </section>

      <div className="mx-auto max-w-[1280px] px-6 py-10 md:py-14 grid lg:grid-cols-[1fr_400px] gap-8 items-start">
        {/* ——— Le formulaire ——— */}
        <Reveal as="div" variant="fade" className="bg-white rounded-[24px] shadow-soft border p-6 md:p-8">
          {/* Onglets produit : bornes et pas du curseur lus dans PRODUITS. */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2" role="tablist" aria-label={tr("nav.products")}>
            {PRODUCT_TYPES.map((code) => (
              <button
                key={code}
                type="button"
                role="tab"
                aria-selected={etat.product === code}
                onClick={() => changerProduit(code)}
                className={cn(
                  "h-10 rounded-full text-[12px] font-extrabold uppercase tracking-wider border transition",
                  etat.product === code
                    ? "bg-ink text-white border-ink"
                    : "bg-white text-slate-500 border-slate-200 hover:border-ink/40 hover:text-ink",
                )}
              >
                {tr(CLES_TAB[code])}
              </button>
            ))}
          </div>

          <div className="mt-8 grid md:grid-cols-2 gap-x-8 gap-y-7">
            {/* Montant */}
            <div>
              <div className="flex justify-between items-baseline">
                <label htmlFor="sim-montant" className="text-[12px] font-bold tracking-widest uppercase text-slate-500">
                  {tr("credit:simulator.amount")}
                </label>
                <span className="font-extrabold text-ink text-lg tabular-nums">{formatCurrency0(etat.amount, locale)}</span>
              </div>
              <input
                id="sim-montant"
                type="range"
                min={produit.min}
                max={produit.max}
                step={produit.pas}
                value={etat.amount}
                onChange={(e) => setEtat({ ...etat, amount: Number(e.target.value) })}
                className="mt-3 w-full accent-primary"
              />
              <div className="flex justify-between text-[11px] text-slate-400 tabular-nums">
                <span>{formatCurrency0(produit.min, locale)}</span>
                <span>{formatCurrency0(produit.max, locale)}</span>
              </div>
            </div>
            {/* Durée */}
            <div>
              <div className="flex justify-between items-baseline">
                <label htmlFor="sim-duree" className="text-[12px] font-bold tracking-widest uppercase text-slate-500">
                  {tr("credit:simulator.term")}
                </label>
                <span className="font-extrabold text-ink text-lg tabular-nums">{t(locale, "credit:simulator.months", { term: etat.term })}</span>
              </div>
              <input
                id="sim-duree"
                type="range"
                min={produit.minTerm}
                max={produit.maxTerm}
                step={1}
                value={etat.term}
                onChange={(e) => setEtat({ ...etat, term: Number(e.target.value) })}
                className="mt-3 w-full accent-primary"
              />
              <div className="flex justify-between text-[11px] text-slate-400 tabular-nums">
                <span>{t(locale, "credit:simulator.months", { term: produit.minTerm })}</span>
                <span>{t(locale, "credit:simulator.months", { term: produit.maxTerm })}</span>
              </div>
            </div>

            {/* Revenus / charges / crédits existants */}
            <div>
              <label htmlFor="sim-revenus" className="text-[12px] font-bold tracking-widest uppercase text-slate-500">
                {tr("credit:simulator.income")}
              </label>
              <input
                id="sim-revenus"
                type="number"
                inputMode="numeric"
                min={0}
                step={50}
                value={etat.income}
                onChange={(e) => setEtat({ ...etat, income: Math.max(0, Number(e.target.value) || 0) })}
                className="mt-2 w-full h-11 rounded-xl border border-slate-200 px-3 font-bold text-ink tabular-nums focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label htmlFor="sim-charges" className="text-[12px] font-bold tracking-widest uppercase text-slate-500">
                {tr("credit:simulator.charges")} <span className="normal-case font-medium text-slate-400">({tr("credit:simulator.chargesNote")})</span>
              </label>
              <input
                id="sim-charges"
                type="number"
                inputMode="numeric"
                min={0}
                step={50}
                value={etat.charges}
                onChange={(e) => setEtat({ ...etat, charges: Math.max(0, Number(e.target.value) || 0) })}
                className="mt-2 w-full h-11 rounded-xl border border-slate-200 px-3 font-bold text-ink tabular-nums focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label htmlFor="sim-existants" className="text-[12px] font-bold tracking-widest uppercase text-slate-500">
                {tr("credit:simulator.existingCredits")}
              </label>
              <input
                id="sim-existants"
                type="number"
                inputMode="numeric"
                min={0}
                step={50}
                value={etat.existing}
                onChange={(e) => setEtat({ ...etat, existing: Math.max(0, Number(e.target.value) || 0) })}
                className="mt-2 w-full h-11 rounded-xl border border-slate-200 px-3 font-bold text-ink tabular-nums focus:outline-none focus:border-primary"
              />
            </div>

            {/* Trois listes déroulantes : options = tableaux exportés du moteur, libellés = dictionnaire. */}
            <div>
              <label htmlFor="sim-typerevenu" className="text-[12px] font-bold tracking-widest uppercase text-slate-500">
                {tr("credit:simulator.incomeTypeLabel")}
              </label>
              <select
                id="sim-typerevenu"
                value={etat.incomeType}
                onChange={(e) => setEtat({ ...etat, incomeType: e.target.value as IncomeType })}
                className="mt-2 w-full h-11 rounded-xl border border-slate-200 px-3 font-semibold text-ink bg-white focus:outline-none focus:border-primary"
              >
                {INCOME_TYPES.map((c) => (
                  <option key={c} value={c}>{tr(CLES_REVENU[c])}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="sim-emploi" className="text-[12px] font-bold tracking-widest uppercase text-slate-500">
                {tr("credit:simulator.employmentLabel")}
              </label>
              <select
                id="sim-emploi"
                value={etat.employment}
                onChange={(e) => setEtat({ ...etat, employment: e.target.value as EmploymentStatus })}
                className="mt-2 w-full h-11 rounded-xl border border-slate-200 px-3 font-semibold text-ink bg-white focus:outline-none focus:border-primary"
              >
                {EMPLOYMENT_STATUSES.map((c) => (
                  <option key={c} value={c}>{tr(CLES_EMPLOI[c])}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="sim-objet" className="text-[12px] font-bold tracking-widest uppercase text-slate-500">
                {tr("credit:simulator.purposeLabel")}
              </label>
              <select
                id="sim-objet"
                value={etat.purpose}
                onChange={(e) => setEtat({ ...etat, purpose: e.target.value as LoanPurpose })}
                className="mt-2 w-full h-11 rounded-xl border border-slate-200 px-3 font-semibold text-ink bg-white focus:outline-none focus:border-primary"
              >
                {LOAN_PURPOSES.map((c) => (
                  <option key={c} value={c}>{tr(CLES_OBJET[c])}</option>
                ))}
              </select>
            </div>
          </div>

          <p className="mt-6 text-[11px] leading-5 text-slate-400 border-l-2 border-primary/50 pl-3">
            {tr("credit:simulator.legal")} {tr("credit:simulator.configurableNote")}
          </p>
        </Reveal>

        {/* ——— Le résultat ——— */}
        <Reveal as="div" variant="left" retard={120} className="lg:sticky lg:top-24 space-y-4">
          <div className="bg-white rounded-[24px] shadow-card border p-6">
            <div className="text-[11px] font-bold tracking-widest uppercase text-slate-500">{tr("credit:simulator.monthly")}</div>
            <div className="mt-1 font-display font-extrabold text-ink text-[44px] leading-none tracking-tight tabular-nums">
              <CountUp a={monthlyPayment * 100} final={mensualiteFinale} declencheur="montage" duree={500} format={(n) => formatEUR2(n / 100, locale)} />
              <span className="text-[15px] font-bold text-slate-400"> {tr("credit:simulator.perMonth")}</span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-center">
              <div className="rounded-2xl bg-surface border p-3">
                <div className="text-[10px] font-bold tracking-widest uppercase text-slate-500">{tr("credit:simulator.taegIndicative")}</div>
                <div className="font-extrabold text-primary text-xl mt-1 tabular-nums">{formatPercent(taeg, locale, 2)}</div>
              </div>
              <div className="rounded-2xl bg-surface border p-3">
                <div className="text-[10px] font-bold tracking-widest uppercase text-slate-500">{tr("credit:simulator.fileFee")}</div>
                <div className="font-extrabold text-ink text-xl mt-1 tabular-nums">{formatCurrency0(fees.file, locale)}</div>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-slate-100 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">{tr("credit:simulator.total")}</span>
                <span className="font-extrabold text-ink tabular-nums">{formatCurrency0(totalCost, locale)}</span>
              </div>
              <div className="flex justify-between text-[12px] text-slate-400">
                <span>{tr("credit:simulator.breakdown", { interest: formatCurrency0(totalInterest, locale), fees: formatCurrency0(fees.total, locale) })}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">{tr("credit:eligibility.debtRatio")}</span>
                <span className={cn("font-extrabold tabular-nums", ratioFin && ratio > 0.33 ? "text-amber-600" : "text-emerald-600")}>
                  {ratioFin ? formatPercent(ratio, locale, 1) : "∞"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">{tr("credit:eligibility.capacity")}</span>
                <span className="font-extrabold text-ink tabular-nums">{formatCurrency0(simulation.eligibility.repaymentCapacity, locale)}</span>
              </div>
            </div>
          </div>

          {/* Recommandation moteur + score : le moteur recommande, l'humain décide. */}
          <div className="bg-white rounded-[24px] shadow-card border p-6">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-bold tracking-widest uppercase text-slate-500">{tr("credit:simulator.engineRecommendation")}</div>
              <span
                className={cn(
                  "px-2.5 py-1 rounded-full text-[10px] font-extrabold tracking-widest uppercase border",
                  simulation.recommendation === "APPROVE_RECOMMENDATION" && "bg-emerald-50 text-emerald-700 border-emerald-200",
                  simulation.recommendation === "REVIEW_RECOMMENDATION" && "bg-amber-50 text-amber-700 border-amber-200",
                  simulation.recommendation === "REJECT_RECOMMENDATION" && "bg-red-50 text-red-700 border-red-200",
                )}
              >
                {simulation.recommendation.replace("_RECOMMENDATION", "")}
              </span>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <Gauge className="w-5 h-5 text-primary shrink-0" aria-hidden="true" />
              <p className="text-[12px] text-slate-500">
                {tr("credit:simulator.scoreExplanation", {
                  value: String(simulation.score.value),
                  grade: simulation.score.grade,
                  pct: ratioFin ? formatPercent(ratio, locale, 1) : "∞",
                })}
              </p>
            </div>
            <div className="mt-3 space-y-1.5">
              {(Object.keys(simulation.score.breakdown) as Array<keyof typeof simulation.score.breakdown>).map((f) => (
                <div key={f} className="flex justify-between text-[12px]">
                  <span className="text-slate-500">{tr(CLES_FACTEUR[f])}</span>
                  <span className="font-bold text-ink tabular-nums">{simulation.score.breakdown[f]}/
                    {f === "debtRatio" ? 35 : f === "incomeStability" ? 25 : f === "employment" ? 20 : 10}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-slate-400 flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> {tr("credit:simulator.humanDecision")}
            </p>
          </div>

          {/* Alertes moteur — clés interpolées, jamais les messages backend. */}
          {simulation.warnings.length > 0 && (
            <div className="bg-amber-50 rounded-[24px] border border-amber-200 p-6">
              <ul className="space-y-2">
                {simulation.warnings.map((w) => (
                  <li key={w.code} className="text-[13px] leading-5 text-amber-800 font-semibold">
                    • {tr(CLES_ALERTE[w.code as (typeof SIMULATION_WARNINGS)[number]], variablesAlerte(w.code as (typeof SIMULATION_WARNINGS)[number]))}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Documents requis — codes → clés documents.* du dictionnaire. */}
          <details className="bg-white rounded-[24px] shadow-card border p-6 group">
            <summary className="cursor-pointer list-none flex items-center justify-between text-[12px] font-bold tracking-widest uppercase text-slate-600">
              <span className="flex items-center gap-2"><FileText className="w-4 h-4 text-primary" aria-hidden="true" /> {tr("credit:simulator.requiredDocs")}</span>
              <span className="text-slate-400">{t(locale, "credit:documents.count", { count: simulation.requiredDocuments.length })}</span>
            </summary>
            <ul className="mt-3 space-y-1.5">
              {simulation.requiredDocuments.map((d) => (
                <li key={d.code} className="text-[13px] text-slate-600">
                  — {tr(CLES_DOC[d.code as (typeof DOCUMENT_CODES)[number]])}
                </li>
              ))}
            </ul>
          </details>
        </Reveal>
      </div>

      {/* ——— L'échéancier, panneau sombre ——— */}
      <section className="mx-auto max-w-[1280px] px-6 pb-14 md:pb-20">
        <Reveal as="div" variant="fade" className="bg-ink text-white rounded-[24px] p-6 md:p-8 relative overflow-hidden">
          <div className="maillage opacity-40" aria-hidden="true" />
          <div className="relative">
            <h2 className="font-display font-extrabold text-[24px] md:text-[28px] tracking-tight">
              {tr("credit:simulator.scheduleTitle", { shown: String(Math.min(MOIS_AFFICHES, schedule.length)), total: String(schedule.length) })}
            </h2>
            <div className="mt-5 overflow-x-auto">
              <table className="w-full text-[13px] tabular-nums min-w-[560px]">
                <thead>
                  <tr className="text-[10px] tracking-widest uppercase text-white/50 border-b border-white/10">
                    <th className="text-left font-bold py-2 pr-4">#</th>
                    <th className="text-right font-bold py-2 px-4">{tr("credit:simulator.monthly")}</th>
                    <th className="text-right font-bold py-2 px-4">{tr("credit:simulator.interests")}</th>
                    <th className="text-right font-bold py-2 px-4">{tr("credit:simulator.principal")}</th>
                    <th className="text-right font-bold py-2 pl-4">{tr("credit:simulator.balance")}</th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.slice(0, MOIS_AFFICHES).map((ligne) => (
                    <tr key={ligne.month} className="border-b border-white/5 hover:bg-white/5 transition">
                      <td className="py-2 pr-4 text-white/50">{ligne.month}</td>
                      <td className="py-2 px-4 text-right font-bold">{formatEUR2(ligne.payment, locale)}</td>
                      <td className="py-2 px-4 text-right text-white/70">{formatEUR2(ligne.interest, locale)}</td>
                      <td className="py-2 px-4 text-right text-white/70">{formatEUR2(ligne.principal, locale)}</td>
                      <td className="py-2 pl-4 text-right text-white/70">{formatEUR2(ligne.balance, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-[11px] leading-5 text-white/45">{tr("legal:disclaimer.simulation")}</p>
          </div>
        </Reveal>
      </section>
    </div>
  );
}
