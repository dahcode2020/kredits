"use client";
/**
 * « use client » : les callbacks de formatage passés à CountUp ne traversent pas la frontière
 * serveur→client. Rendu par le serveur (SSR) quand même ; aucune API navigateur au render.
 *
 * Bandeau de chiffres façon Dewi — mais sans UNE donnée fausse :
 * - chaque grand nombre est le plafond de montant du produit, lu dans PRODUITS
 *   (lib/credit-engine.ts), compté par CountUp jusqu'à la chaîne exacte rendue par le serveur ;
 * - les deux libellés (« jusqu'à », « à partir de ») RÉUTILISENT des clés existantes
 *   (heroCard.upTo, products.from) : zéro clé inventée, zéro chaîne en dur ;
 * - décoratif et factuel : ce sont les bornes contractuelles de l'offre, pas des statistiques
 *   marketing (les clés stats.* / hero.trust de l'ancien site, fausses, restent non rendues).
 */
import Reveal from "@/components/motion/Reveal";
import CountUp from "@/components/motion/CountUp";
import { formatMontantCompact } from "@/lib/formatters";
import { Locale, t } from "@/lib/i18n";
import { PRODUITS, PRODUCT_TYPES, type ProductCode } from "@/lib/credit-engine";

/* Clés de dictionnaire en littéraux STATIQUES : le scan de parité doit les voir. */
const CLES_NOM: Record<ProductCode, string> = {
  PERSONAL: "products.personal",
  MORTGAGE: "products.mortgage",
  BUSINESS: "products.business",
  INVESTMENT: "products.invest",
};

export default function StatsBand({ locale }: { locale: Locale }) {
  const tr = (k: string) => t(locale, k);
  return (
    <Reveal as="div" variant="fade" className="relative mt-12 grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
      {PRODUCT_TYPES.map((code, i) => {
        const p = PRODUITS[code];
        const final = formatMontantCompact(p.max, locale);
        return (
          <Reveal
            as="div"
            key={code}
            retard={i * 70}
            pas={24}
            className="rounded-2xl bg-white/[0.06] border border-white/10 backdrop-blur px-4 py-4 md:px-5 text-center"
          >
            <div className="text-[10px] font-bold tracking-widest uppercase text-white/50">{tr(CLES_NOM[code])}</div>
            <div className="mt-1 font-display font-extrabold text-white text-[22px] md:text-[28px] tracking-tight leading-none">
              <span className="mr-1.5 text-[11px] md:text-[12px] font-bold tracking-widest uppercase text-white/50 align-middle">
                {tr("heroCard.upTo")}
              </span>
              <CountUp a={p.max} final={final} duree={1100} format={(n) => formatMontantCompact(n, locale)} />
            </div>
            <div className="mt-1.5 text-[11px] text-white/45">
              {tr("products.from")} {formatMontantCompact(p.min, locale)}
            </div>
          </Reveal>
        );
      })}
    </Reveal>
  );
}
