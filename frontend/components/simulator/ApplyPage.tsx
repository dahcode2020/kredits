"use client";
/**
 * « use client » : formulaire et persistance locale. Rendu serveur d'abord, avec l'état pré-rempli
 * passé en props (même HTML côté serveur et premier rendu client) ; le localStorage n'est lu/écrit
 * que dans les handlers et après soumission — jamais au render (contrat d'hydratation).
 *
 * Honnêteté : sans backend, « déposer » enregistre la demande SUR L'APPAREIL et l'écran le dit
 * (`application.saved`) ; rien n'est « envoyé » en silence, aucun faux statut de traitement.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BadgeCheck, FileText } from "lucide-react";
import Reveal from "@/components/motion/Reveal";
import { buttonClasses } from "@/components/ui/Button";
import { formatCurrency0, formatPercent } from "@/lib/formatters";
import { formatEUR2 } from "@/lib/utils";
import { Locale, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { ajouterDemande, lireDemandes, nouvelleReference, queryDepuisEtat, type DemandeLocale, type EtatSimulation } from "@/lib/application";
import {
  DOCUMENT_CODES, simulateCredit,
  type EmploymentStatus, type IncomeType, type LoanPurpose, type ProductCode,
} from "@/lib/credit-engine";

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
const CLES_DOC: Record<(typeof DOCUMENT_CODES)[number], string> = {
  ID: "credit:documents.ID",
  INCOME_3M: "credit:documents.INCOME_3M",
  PROOF_ADDRESS: "credit:documents.PROOF_ADDRESS",
  PROPERTY_VALUATION: "credit:documents.PROPERTY_VALUATION",
  BANK_STATEMENTS_3M: "credit:documents.BANK_STATEMENTS_3M",
  TAX_RETURN_2Y: "credit:documents.TAX_RETURN_2Y",
  BUSINESS_PLAN: "credit:documents.BUSINESS_PLAN",
};

const EMAIL_VALIDE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default function ApplyPage({ locale, initial }: { locale: Locale; initial: EtatSimulation }) {
  const tr = (k: string, vars?: Record<string, string | number>) => t(locale, k, vars);
  const [etat] = useState(initial);
  const [nom, setNom] = useState("");
  const [email, setEmail] = useState("");
  const [telephone, setTelephone] = useState("");
  const [consent, setConsent] = useState(false);
  const [erreurs, setErreurs] = useState<{ nom?: string; email?: string; consent?: string; produit?: string }>({});
  const [confirmee, setConfirmee] = useState<DemandeLocale | null>(null);

  const simulation = useMemo(
    () =>
      simulateCredit({
        amount: etat.amount, termMonths: etat.term, monthlyIncome: etat.income,
        monthlyCharges: etat.charges, incomeType: etat.incomeType, employmentStatus: etat.employment,
        loanPurpose: etat.purpose, existingCreditsMonthly: etat.existing, country: "BE",
        productType: etat.product,
      }),
    [etat],
  );
  const { monthlyPayment, taeg, fees } = simulation.simulation;

  const deposer = () => {
    const e: typeof erreurs = {};
    if (nom.trim().length < 2) e.nom = "credit:application.errName";
    if (!EMAIL_VALIDE.test(email.trim())) e.email = "credit:application.errEmail";
    if (!consent) e.consent = "credit:application.errConsent";
    // Règle métier : un client ayant un prêt EN COURS dans une catégorie ne peut pas
    // déposer une seconde demande dans la même catégorie.
    if (lireDemandes().some((d) => d.etat.product === etat.product)) e.produit = "credit:application.errSameProduct";
    setErreurs(e);
    if (Object.keys(e).length) return;
    const demande: DemandeLocale = {
      id: nouvelleReference(new Date()),
      createdAt: new Date().toISOString(),
      statut: "SUBMITTED",
      etat,
      nom: nom.trim(),
      email: email.trim(),
      telephone: telephone.trim(),
    };
    ajouterDemande(demande);
    setConfirmee(demande);
  };

  const ligne = (libelle: string, valeur: string) => (
    <div className="flex justify-between text-sm py-1.5 border-b border-slate-100 last:border-0">
      <span className="text-slate-500">{libelle}</span>
      <span className="font-bold text-ink tabular-nums text-right">{valeur}</span>
    </div>
  );

  return (
    <div className="bg-surface">
      <section className="relative overflow-hidden bg-ink">
        <div className="maillage" aria-hidden="true" />
        <div className="relative mx-auto max-w-[1280px] px-6 py-12 md:py-16">
          <Reveal as="div" variant="fade">
            <Link href={`/${locale}/credit/simulator?${queryDepuisEtat(etat)}`} className={buttonClasses("outline", "md", "gap-2")}>
              <ArrowLeft className="w-4 h-4" aria-hidden="true" /> {tr("action.back")}
            </Link>
          </Reveal>
          <Reveal as="h1" retard={90} className="mt-5 font-display font-extrabold text-white text-[36px] md:text-[46px] leading-[1.02] tracking-tight">
            {tr("credit:simulator.request")}
          </Reveal>
          <Reveal as="p" retard={160} className="mt-3 text-[15px] leading-7 text-white/70 max-w-[640px]">
            {tr("credit:application.newSub")}
          </Reveal>
        </div>
      </section>

      <div className="mx-auto max-w-[1280px] px-6 py-10 md:py-14 grid lg:grid-cols-[1fr_420px] gap-8 items-start">
        {confirmee ? (
          /* ——— Confirmation : la demande existe sur l'appareil, et l'écran le dit. ——— */
          <Reveal as="div" variant="fade" className="lg:col-span-2 bg-white rounded-[24px] shadow-card border p-6 md:p-10">
            <div className="flex items-center gap-3">
              <span className="w-12 h-12 rounded-full bg-emerald-50 border border-emerald-200 grid place-items-center">
                <BadgeCheck className="w-6 h-6 text-emerald-600" aria-hidden="true" />
              </span>
              <div>
                <div className="font-extrabold text-ink text-xl">{tr("credit:status.SUBMITTED")}</div>
                <div className="text-sm text-slate-500">
                  {tr("credit:application.reference")} : <span className="font-bold text-ink tabular-nums">{confirmee.id}</span>
                </div>
              </div>
            </div>
            <div className="mt-6 grid md:grid-cols-2 gap-x-10">
              <div>
                {ligne(tr(CLES_TAB[etat.product]), formatCurrency0(etat.amount, locale))}
                {ligne(tr("credit:simulator.term"), tr("credit:simulator.months", { term: etat.term }))}
                {ligne(tr("credit:simulator.monthly"), `${formatEUR2(monthlyPayment, locale)} ${tr("credit:simulator.perMonth")}`)}
                {ligne(tr("credit:simulator.taegIndicative"), formatPercent(taeg, locale, 2))}
              </div>
              <div>
                {ligne(tr("contact.name"), confirmee.nom)}
                {ligne(tr("contact.email"), confirmee.email)}
                {ligne(tr("credit:application.statusLabel"), tr("credit:status.SUBMITTED"))}
              </div>
            </div>
            <p className="mt-6 text-[13px] leading-6 text-slate-500 border-l-2 border-primary/50 pl-3">{tr("credit:application.saved")}</p>
            <p className="mt-2 text-[13px] leading-6 text-slate-500">{tr("credit:application.afterBody")}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href={`/${locale}`} className={buttonClasses("primary", "md")}>{tr("shell.notFoundHome")}</Link>
              <Link href={`/${locale}/credit/simulator?${queryDepuisEtat(etat)}`} className={buttonClasses("outline-light", "md")}>
                {tr("action.back")}
              </Link>
            </div>
          </Reveal>
        ) : (
          <>
            {/* ——— Coordonnées + consentement ——— */}
            <Reveal as="div" variant="fade" className="bg-white rounded-[24px] shadow-soft border p-6 md:p-8">
              <h2 className="font-extrabold text-ink text-lg">{tr("credit:application.contactTitle")}</h2>
              <div className="mt-5 grid md:grid-cols-2 gap-x-6 gap-y-5">
                <div>
                  <label htmlFor="dem-nom" className="text-[12px] font-bold tracking-widest uppercase text-slate-500">{tr("contact.name")}</label>
                  <input
                    id="dem-nom" type="text" autoComplete="name" value={nom}
                    placeholder={tr("contact.namePh")}
                    onChange={(e) => setNom(e.target.value)}
                    className="mt-2 w-full h-11 rounded-xl border border-slate-200 px-3 font-semibold text-ink focus:outline-none focus:border-primary"
                  />
                  {erreurs.nom && <p role="alert" className="mt-1 text-[12px] font-semibold text-red-600">{tr(erreurs.nom)}</p>}
                </div>
                <div>
                  <label htmlFor="dem-email" className="text-[12px] font-bold tracking-widest uppercase text-slate-500">{tr("contact.email")}</label>
                  <input
                    id="dem-email" type="email" autoComplete="email" value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="mt-2 w-full h-11 rounded-xl border border-slate-200 px-3 font-semibold text-ink focus:outline-none focus:border-primary"
                  />
                  {erreurs.email && <p role="alert" className="mt-1 text-[12px] font-semibold text-red-600">{tr(erreurs.email)}</p>}
                </div>
                <div className="md:col-span-2">
                  <label htmlFor="dem-tel" className="text-[12px] font-bold tracking-widest uppercase text-slate-500">
                    {tr("credit:application.phone")}
                  </label>
                  <input
                    id="dem-tel" type="tel" autoComplete="tel" value={telephone}
                    placeholder={tr("credit:application.phonePh")}
                    onChange={(e) => setTelephone(e.target.value)}
                    className="mt-2 w-full h-11 rounded-xl border border-slate-200 px-3 font-semibold text-ink focus:outline-none focus:border-primary"
                  />
                </div>
              </div>
              <label className="mt-6 flex items-start gap-3 text-[13px] leading-5 text-slate-600 cursor-pointer">
                <input
                  type="checkbox" checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-primary"
                />
                <span>{tr("contact.consent")}</span>
              </label>
              {erreurs.consent && <p role="alert" className="mt-1 text-[12px] font-semibold text-red-600">{tr(erreurs.consent)}</p>}
              {erreurs.produit && <p role="alert" className="mt-4 rounded-xl bg-amber-50 border border-amber-200 p-3 text-[13px] font-bold text-amber-800">{tr(erreurs.produit)}</p>}
              <button type="button" onClick={deposer} className={buttonClasses("primary", "lg", "w-full mt-6")}>
                {tr("credit:application.submit")}
              </button>
              <p className="mt-4 text-[11px] leading-5 text-slate-400">{tr("contact.noSensitive")}</p>
            </Reveal>

            {/* ——— La simulation reprise, telle quelle ——— */}
            <Reveal as="div" variant="left" retard={120} className="bg-white rounded-[24px] shadow-card border p-6">
              <h2 className="font-extrabold text-ink text-lg">{tr("credit:application.summaryTitle")}</h2>
              <div className="mt-4">
                {ligne(tr(CLES_TAB[etat.product]), formatCurrency0(etat.amount, locale))}
                {ligne(tr("credit:simulator.term"), tr("credit:simulator.months", { term: etat.term }))}
                {ligne(tr("credit:simulator.income"), formatCurrency0(etat.income, locale))}
                {ligne(tr("credit:simulator.charges"), formatCurrency0(etat.charges, locale))}
                {ligne(tr("credit:simulator.incomeTypeLabel"), tr(CLES_REVENU[etat.incomeType]))}
                {ligne(tr("credit:simulator.employmentLabel"), tr(CLES_EMPLOI[etat.employment]))}
                {ligne(tr("credit:simulator.purposeLabel"), tr(CLES_OBJET[etat.purpose]))}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-center">
                <div className="rounded-2xl bg-surface border p-3">
                  <div className="text-[10px] font-bold tracking-widest uppercase text-slate-500">{tr("credit:simulator.monthly")}</div>
                  <div className="font-extrabold text-ink text-lg mt-1 tabular-nums">{formatEUR2(monthlyPayment, locale)}</div>
                </div>
                <div className="rounded-2xl bg-surface border p-3">
                  <div className="text-[10px] font-bold tracking-widest uppercase text-slate-500">{tr("credit:simulator.taegIndicative")}</div>
                  <div className="font-extrabold text-primary text-lg mt-1 tabular-nums">{formatPercent(taeg, locale, 2)}</div>
                </div>
              </div>
              <div className="mt-5">
                <div className="text-[11px] font-bold tracking-widest uppercase text-slate-500 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-primary" aria-hidden="true" /> {tr("credit:simulator.requiredDocs")}
                </div>
                <ul className="mt-2 space-y-1.5">
                  {simulation.requiredDocuments.map((d) => (
                    <li key={d.code} className="text-[13px] text-slate-600">
                      — {tr(CLES_DOC[d.code as (typeof DOCUMENT_CODES)[number]])}
                    </li>
                  ))}
                </ul>
              </div>
              <p className="mt-5 text-[11px] leading-5 text-slate-400 border-l-2 border-primary/50 pl-3">{tr("legal:disclaimer.simulation")}</p>
            </Reveal>
          </>
        )}
      </div>
    </div>
  );
}
