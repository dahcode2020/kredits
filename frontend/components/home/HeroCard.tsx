"use client";
/**
 * « use client »: la carte passe des callbacks de formatage à CountUp — une fonction ne traverse
 * pas la frontière serveur→client. Le composant reste rendu par le serveur (SSR), son code ne lit
 * aucune API navigateur au render: le contrat d'hydratation tient.
 */
import { Lock, FileCheck, Scale } from "lucide-react";
import CountUp from "@/components/motion/CountUp";
import { Badge } from "@/components/ui/Button";
import { formatMontantCompact, formatPercent } from "@/lib/formatters";
import { formatEUR2 } from "@/lib/utils";
import { Locale, gdprAcronym, t } from "@/lib/i18n";
import { PALIERS_TAUX, PRODUITS, simulateCredit } from "@/lib/credit-engine";

/**
 * La carte « vitrine » du hero — chaque nombre y est calculé, rien n'y est tapé.
 *
 * - TAEG plancher de la plate-forme: le taux du dernier palier (lib/credit-engine.ts). C'est une
 *   borne basse démontrable: le TAEG = taux nominal + frais lissés, donc jamais sous le nominal —
 *   « TAEG à partir de 1,50 % » est vrai pour toutes les configurations de la grille.
 * - Plafond: PRODUITS.MORTGAGE.max, lu dans la table.
 * - L'exemple (15 000 € / 48 mois, repris du libellé `heroCard.example`) passe dans le moteur:
 *   mensualité et TAEG sortent du même objet et ne peuvent donc pas se contredire.
 * - Pas de bouton « Lancer le simulateur »: la route n'existe pas encore (slice 2). Un CTA sans
 *   destination est pire qu'un CTA absent.
 *
 * Composant serveur: seul CountUp (client) anime, et son contrat `final` garantit le retour exact
 * à la chaîne rendue par le serveur (docs/motion.md).
 */
const VITRINE = simulateCredit({
  amount: 15_000, termMonths: 48, monthlyIncome: 3_200, monthlyCharges: 600,
  incomeType: "SALARY", employmentStatus: "CDI", loanPurpose: "VEHICLE",
  existingCreditsMonthly: 0, country: "BE", productType: "PERSONAL",
});

const TAUX_PLANCHER = PALIERS_TAUX[PALIERS_TAUX.length - 1].taux;

export default function HeroCard({ locale }: { locale: Locale }) {
  const tr = (k: string) => t(locale, k);
  const taegFinal = formatPercent(TAUX_PLANCHER, locale, 2);
  const plafondFinal = formatMontantCompact(PRODUITS.MORTGAGE.max, locale);
  return (
    <div className="bg-white rounded-[24px] shadow-card p-6 md:p-7">
      <div className="flex items-center justify-between">
        <Badge>{tr("heroCard.badge")}</Badge>
        <span className="text-xs font-bold text-emerald-600 flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-emerald-500" aria-hidden="true" /> {tr("heroCard.status")}
        </span>
      </div>
      <h2 className="mt-4 font-extrabold text-ink text-lg">{tr("heroCard.title")}</h2>
      <p className="text-sm text-slate-500">{tr("heroCard.subtitle")}</p>

      <div className="mt-5 grid grid-cols-2 gap-3 text-center">
        <div className="rounded-2xl bg-surface border p-3">
          <div className="text-[11px] font-bold tracking-widest uppercase text-slate-500">{t(locale, "credit:simulator.taeg")}</div>
          <div className="font-extrabold text-ink text-xl mt-1">
            <CountUp a={TAUX_PLANCHER * 100} final={taegFinal} duree={1150} format={(n) => formatPercent(n / 100, locale, 2)} />
          </div>
        </div>
        <div className="rounded-2xl bg-surface border p-3">
          <div className="text-[11px] font-bold tracking-widest uppercase text-slate-500">{tr("heroCard.upTo")}</div>
          <div className="font-extrabold text-ink text-xl mt-1">
            <CountUp a={PRODUITS.MORTGAGE.max} final={plafondFinal} duree={1150} format={(n) => formatMontantCompact(Math.round(n), locale)} />
          </div>
          <div className="text-[11px] text-slate-400">{tr("heroCard.upToSub")}</div>
        </div>
      </div>

      <div className="mt-5 space-y-2.5">
        <div className="flex justify-between text-sm">
          <span className="text-slate-500">{tr("heroCard.example")}</span>
          <span className="font-bold text-ink">{formatEUR2(VITRINE.simulation.monthlyPayment, locale)} {t(locale, "credit:simulator.perMonth")}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-slate-500">{t(locale, "credit:simulator.taegIndicative")}</span>
          <span className="font-bold text-ink">{formatPercent(VITRINE.simulation.taeg, locale, 2)}</span>
        </div>
        <p className="text-[11px] text-slate-400 pt-1">{tr("heroCard.note")}</p>
      </div>

      <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-center gap-4 text-[11px] text-slate-400">
        <span className="flex items-center gap-1"><Lock className="w-3 h-3" aria-hidden="true" /> {gdprAcronym[locale]}</span>
        <span className="flex items-center gap-1"><FileCheck className="w-3 h-3" aria-hidden="true" /> eIDAS</span>
        <span className="flex items-center gap-1"><Scale className="w-3 h-3" aria-hidden="true" /> FSMA</span>
      </div>
    </div>
  );
}
