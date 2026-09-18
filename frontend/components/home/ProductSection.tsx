"use client";
/**
 * « use client »: les callbacks de formatage passés à CountUp ne traversent pas la frontière
 * serveur→client. Rendu par le serveur (SSR) quand même; aucune API navigateur au render.
 */
import { Wallet, Home, Briefcase, BarChart3, Info } from "lucide-react";
import Reveal from "@/components/motion/Reveal";
import CountUp from "@/components/motion/CountUp";
import { formatMontantCompact, formatPercent } from "@/lib/formatters";
import { formatCurrency0 } from "@/lib/formatters";
import { Locale, t } from "@/lib/i18n";
import { PALIERS_TAUX, PRODUITS, PRODUCT_TYPES, simulateCredit, tauxMiniProduit, tauxPour, type ProductCode } from "@/lib/credit-engine";

/**
 * L'offre et sa grille — le cœur de la règle « une valeur = une table = un endroit ».
 *
 * Chaque nombre affiché ici est LU dans lib/credit-engine.ts:
 * - bornes et durées des quatre produits: PRODUITS (jamais recopiées dans le JSX ni dans les
 *   dictionnaires — les libellés `products.*.desc` ne portent plus aucun chiffre, verrouillé par
 *   tests/unit/credit-tiers.spec.ts);
 * - les quatre paliers de taux: PALIERS_TAUX, le taux suit le montant, pas le produit;
 * - le contre-exemple de transparence (1 500 € / 12 mois): passé dans le moteur, qui rend un TAEG
 *   de 7,50 % — les 75 € de frais minimum pèsent 5 % sur un an. Le brief exige ce détail affiché:
 *   un « dès 2,50 % » sans lui serait une promesse fausse.
 */

const ICONES: Record<ProductCode, typeof Wallet> = {
  PERSONAL: Wallet,
  MORTGAGE: Home,
  BUSINESS: Briefcase,
  INVESTMENT: BarChart3,
};

/* Photographies de marque (générées, décoratives: alt="", aria-hidden) — l'étiquette produit
   reste la clé products.*.tag du dictionnaire, posée sur la photo comme dans l'ancien visuel. */
const IMAGES: Record<ProductCode, string> = {
  PERSONAL: "/images/product-personal.jpg",
  MORTGAGE: "/images/product-mortgage.jpg",
  BUSINESS: "/images/product-business.jpg",
  INVESTMENT: "/images/product-invest.jpg",
};

/** Le contre-exemple déterministe: plancher du produit personnel dans le moteur. */
const CONTRE_EXEMPLE = simulateCredit({
  amount: PRODUITS.PERSONAL.min, termMonths: PRODUITS.PERSONAL.minTerm,
  monthlyIncome: 3_200, monthlyCharges: 600,
  incomeType: "SALARY", employmentStatus: "CDI", loanPurpose: "CONSUMPTION",
  existingCreditsMonthly: 0, country: "BE", productType: "PERSONAL",
});

export default function ProductSection({ locale }: { locale: Locale }) {
  const tr = (k: string) => t(locale, k);
  const tauxPlein = tauxPour(PRODUITS.PERSONAL.min);
  return (
    <section id="produits" className="bg-surface py-16 md:py-24">
      <div className="mx-auto max-w-[1280px] px-6">
        <Reveal as="div" className="text-center max-w-2xl mx-auto">
          <div className="section-title flex justify-center">{tr("featured.title")}</div>
          <h2 className="section-heading mt-2">{tr("featured.subtitle")}</h2>
        </Reveal>

        {/* Les quatre produits: bornes, durées et taux plancher lus dans la table. */}
        <div className="mt-10 grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Clés de dictionnaire en littéraux STATIQUES (jamais construites par concaténation):
              c'est ce qui permet au scan de parité (tests/unit/i18n-keys-usage.spec.ts) de voir
              chaque clé appelée, et donc de vérifier qu'elle existe dans les quatre langues. */}
          {PRODUCT_TYPES.map((code, i) => {
            const p = PRODUITS[code];
            const Icone = ICONES[code];
            const cles = {
              PERSONAL: { nom: "products.personal", desc: "products.personal.desc", tag: "products.personal.tag" },
              MORTGAGE: { nom: "products.mortgage", desc: "products.mortgage.desc", tag: "products.mortgage.tag" },
              BUSINESS: { nom: "products.business", desc: "products.business.desc", tag: "products.business.tag" },
              INVESTMENT: { nom: "products.invest", desc: "products.invest.desc", tag: "products.invest.tag" },
            }[code];
            const mini = tauxMiniProduit(code);
            const miniFinal = formatPercent(mini, locale, 2);
            return (
              <Reveal as="div" key={code} retard={i * 80} pas={28} spotlight className="group bg-white rounded-[20px] shadow-soft border overflow-hidden lift">
                <div className="relative h-48 overflow-hidden">
                  <img src={IMAGES[code]} alt="" aria-hidden="true" className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 motion-safe:group-hover:scale-[1.06]" />
                  <div className="absolute inset-0 bg-gradient-to-t from-ink/60 via-transparent to-transparent" aria-hidden="true" />
                  <span className="absolute left-4 top-4 px-2.5 py-1 rounded-full bg-ink/70 backdrop-blur text-[10px] font-bold tracking-widest uppercase text-white border border-white/20">{tr(cles.tag)}</span>
                </div>
                <div className="p-6 pt-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary-light text-primary grid place-items-center shrink-0"><Icone className="w-5 h-5" aria-hidden="true" /></div>
                  <h3 className="font-extrabold text-ink">{tr(cles.nom)}</h3>
                </div>
                <p className="mt-1 text-sm leading-6 text-slate-500">{tr(cles.desc)}</p>
                <div className="mt-4 pt-4 border-t border-slate-100 space-y-1.5 text-[12px] font-semibold text-slate-500">
                  <div className="flex justify-between">
                    <span>{formatMontantCompact(p.min, locale)} – {formatMontantCompact(p.max, locale)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{p.minTerm}–{p.maxTerm} m</span>
                    <span className="text-ink font-extrabold">
                      {tr("products.from")}{" "}
                      <CountUp a={mini * 100} final={miniFinal} duree={900} format={(n) => formatPercent(n / 100, locale, 2)} />
                    </span>
                  </div>
                </div>
                <p className="text-[11px] text-slate-400 mt-3">{tr("products.note")}</p>
                </div>
              </Reveal>
            );
          })}
        </div>

        {/* La grille de taux: le taux suit le montant, pas le produit. Quatre lignes, une table. */}
        <div id="taux" className="scroll-mt-24 mt-12">
          <Reveal as="div" variant="fade" className="bg-white rounded-[24px] border shadow-soft overflow-hidden">
            <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-slate-100">
              {PALIERS_TAUX.map((palier, i) => {
                const tauxFinal = formatPercent(palier.taux, locale, 2);
                return (
                  <div key={palier.min} className="p-6 text-center">
                    <div className="text-[11px] font-bold tracking-widest uppercase text-slate-400">
                      {formatMontantCompact(palier.min, locale)}{palier.max === Infinity ? " +" : ` – ${formatMontantCompact(palier.max, locale)}`}
                    </div>
                    <div className="mt-2 font-display font-extrabold text-ink text-[28px] tracking-tight">
                      <CountUp a={palier.taux * 100} final={tauxFinal} duree={1000} format={(n) => formatPercent(n / 100, locale, 2)} />
                    </div>
                    <div className="mt-1 h-1 rounded-full bg-primary/80 barre" style={{ "--p": String(1 - i * 0.18) } as React.CSSProperties} aria-hidden="true" />
                  </div>
                );
              })}
            </div>
          </Reveal>

          {/* Le contre-exemple exigé par le brief: sur le plus petit crédit possible, les frais
              minimum font monter le TAEG bien au-delà du taux nominal. Tout est calculé. */}
          <Reveal as="div" retard={120} className="mt-6 bg-ink text-white rounded-[24px] p-6 md:p-8 relative overflow-hidden">
            <div className="maillage opacity-40" aria-hidden="true" />
            <div className="relative grid lg:grid-cols-[1fr_auto] gap-6 items-center">
              <div>
                <div className="text-primary text-[13px] tracking-[0.18em] font-bold uppercase">{tr("services.transparent.t")}</div>
                <p className="mt-2 text-sm leading-6 text-white/70 max-w-[560px]">{tr("services.transparent.d")}</p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="rounded-2xl bg-white/5 border border-white/10 px-4 py-3 text-center">
                  <div className="text-[10px] font-bold tracking-widest uppercase text-white/50">{t(locale, "credit:simulator.amount")}</div>
                  <div className="mt-1 font-extrabold">{formatCurrency0(PRODUITS.PERSONAL.min, locale)}</div>
                </div>
                <div className="rounded-2xl bg-white/5 border border-white/10 px-4 py-3 text-center">
                  <div className="text-[10px] font-bold tracking-widest uppercase text-white/50">{t(locale, "credit:simulator.term")}</div>
                  <div className="mt-1 font-extrabold">{t(locale, "credit:simulator.months", { term: PRODUITS.PERSONAL.minTerm })}</div>
                </div>
                <div className="rounded-2xl bg-white/5 border border-white/10 px-4 py-3 text-center">
                  <div className="text-[10px] font-bold tracking-widest uppercase text-white/50">{t(locale, "credit:simulator.taegIndicative")}</div>
                  <div className="mt-1 font-extrabold text-primary">{formatPercent(CONTRE_EXEMPLE.simulation.taeg, locale, 2)}</div>
                </div>
                <div className="rounded-2xl bg-white/5 border border-white/10 px-4 py-3 text-center">
                  <div className="text-[10px] font-bold tracking-widest uppercase text-white/50">{t(locale, "credit:simulator.fileFee")}</div>
                  <div className="mt-1 font-extrabold">{formatCurrency0(CONTRE_EXEMPLE.simulation.fees.file, locale)}</div>
                </div>
              </div>
            </div>
            <p className="relative mt-5 text-[11px] leading-5 text-white/45 flex items-start gap-2">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
              <span>{t(locale, "legal:disclaimer.simulation")} {tauxPlein !== null && `${tr("products.from")} ${formatPercent(tauxPlein, locale, 2)}.`}</span>
            </p>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
