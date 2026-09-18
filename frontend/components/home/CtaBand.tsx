import Link from "next/link";
import { ArrowRight } from "lucide-react";
import Reveal from "@/components/motion/Reveal";
import Parallax from "@/components/motion/Parallax";
import { buttonClasses } from "@/components/ui/Button";
import { Locale, t } from "@/lib/i18n";

/**
 * Bannière pleine largeur entre deux sections — la respiration visuelle du bas de page.
 *
 * - La clé dormante `cta.simulate` (« Simuler maintenant ») reçoit ici son emplacement :
 *   titre de la bannière, et le bouton principal mène à la route RÉELLE du simulateur.
 * - La photo est générée et décorative (alt="", aria-hidden) : une ambiance, pas une
 *   promesse ; le dégradé à gauche porte le texte, jamais posé sur la photo brute.
 * - Comme le héro : parallax translate3d seul, neutralisé en mouvement réduit.
 */
export default function CtaBand({ locale }: { locale: Locale }) {
  const tr = (k: string) => t(locale, k);
  return (
    <section className="relative overflow-hidden bg-ink">
      <Parallax amplitude={10} className="absolute -inset-[6%]">
        <img src="/images/cta-band.jpg" alt="" aria-hidden="true" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-r from-ink/90 via-ink/55 to-ink/10" aria-hidden="true" />
      </Parallax>
      <div className="relative mx-auto max-w-[1280px] px-6 py-20 md:py-28">
        <Reveal as="div" className="max-w-xl">
          {/* Interligne après les tailles `text-[…]` : tailwind-merge supprime un `leading-[…]`
              placé avant (conflit font-size) — même règle que le héro. */}
          <h2 className="font-display font-extrabold text-white text-[32px] md:text-[40px] leading-[1.05] tracking-tight">{tr("cta.simulate")}</h2>
          <p className="mt-3 text-[15px] leading-7 text-white/75">{tr("hero.subtitle")}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href={`/${locale}/credit/simulator`} className={buttonClasses("primary", "lg", "gap-2")}>
              {tr("hero.cta1")} <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </Link>
            <a href="#produits" className={buttonClasses("outline", "lg", "gap-2")}>
              {tr("hero.cta2")}
            </a>
          </div>
          <p className="mt-5 text-[11px] leading-5 text-white/50">{t(locale, "legal:disclaimer.simulation")}</p>
        </Reveal>
      </div>
    </section>
  );
}
