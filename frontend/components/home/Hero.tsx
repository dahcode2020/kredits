import Link from "next/link";
import { ArrowRight, Shield } from "lucide-react";
import Reveal from "@/components/motion/Reveal";
import Parallax from "@/components/motion/Parallax";
import { buttonClasses } from "@/components/ui/Button";
import HeroCard from "./HeroCard";
import StatsBand from "./StatsBand";
import { Locale, t } from "@/lib/i18n";

/**
 * Tête de page — slice 1.
 *
 * - Zéro texte en dur: tout vient des dictionnaires (t()).
 * - Zéro donnée fausse: les deux seuls nombres de la section (le TAEG plancher et le plafond
 *   hypothécaire de la carte) sortent de lib/credit-engine.ts, pas du JSX.
 * - Zéro CTA mort: depuis la slice 2, le bouton principal « Simuler mon crédit » mène à la route
 *   réelle du simulateur ; le secondaire reste une ancre de cette page (#produits). Avant
 *   l'existence de la route, le CTA n'était tout simplement pas rendu.
 * - Le visuel de fond est un maillage CSS (pas une photo stock « équipe souriante » qui serait un
 *   mensonge de plus): dégradés superposés, aucun fetch.
 */
export default function Hero({ locale }: { locale: Locale }) {
  const tr = (k: string) => t(locale, k);
  return (
    <section className="relative overflow-hidden bg-ink">
      {/* Profondeur: le maillage dérive doucement (Parallax, translate3d uniquement). */}
      <Parallax amplitude={14} className="absolute -inset-[4%]">
        {/* Image décorative (générée, aria-hidden, alt="") : ambiance, pas une promesse. */}
        <img src="/images/hero-bg.jpg" alt="" aria-hidden="true" className="absolute inset-0 w-full h-full object-cover opacity-40" />
        <div className="maillage opacity-70" aria-hidden="true" />
        <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/80 to-ink/30" />
      </Parallax>

      <div className="relative mx-auto max-w-[1280px] px-6 py-16 md:py-24">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <Reveal as="div" variant="fade" className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/15 text-[11px] tracking-widest uppercase font-bold text-white/90 backdrop-blur">
              <span className="w-2 h-2 rounded-full bg-emerald-400" aria-hidden="true" /> {tr("hero.eyebrow")}
            </Reveal>
            <Reveal as="h1" retard={90} pas={28} className="mt-6 font-display font-extrabold text-white leading-[0.95] tracking-tight text-[42px] md:text-[56px]">
              {tr("hero.title1")} <br />
              <span className="text-white">{tr("hero.title2")}</span> <br />
              <span className="text-primary">{tr("hero.title3")}</span>
            </Reveal>
            <Reveal as="p" retard={170} className="mt-5 text-[15px] leading-7 text-white/70 max-w-[560px]">
              {tr("hero.subtitle")}
            </Reveal>

            {/* Rafale calculée (i * 80), jamais aléatoire. Depuis la slice 2, le CTA principal a
                une destination réelle: la route du simulateur. Le secondaire reste une ancre. */}
            <Reveal as="div" retard={250} className="mt-8 flex flex-wrap gap-3">
              <Link href={`/${locale}/credit/simulator`} className={buttonClasses("primary", "lg", "gap-2")}>
                {tr("hero.cta1")} <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </Link>
              <a href="#produits" className={buttonClasses("outline", "lg", "gap-2")}>
                {tr("hero.cta2")}
              </a>
            </Reveal>

            <Reveal as="div" retard={330} className="mt-6 flex items-center gap-3 text-[11px] font-semibold tracking-widest uppercase text-white/50">
              <Shield className="w-4 h-4 text-emerald-400" aria-hidden="true" /> {tr("about.badge")}
            </Reveal>
            {/* Le disclaimer « propre » des dictionnaires: pas de phrase laissée en suspens, pas de
                nombre qui ne sorte d'une table. */}
            <Reveal as="p" retard={400} className="mt-4 text-[11px] leading-5 text-white/45 border-l-2 border-primary/50 pl-3 max-w-[560px]">
              {t(locale, "legal:disclaimer.simulation")}
            </Reveal>
          </div>

          <Reveal as="div" variant="left" retard={160} pas={0} spotlight>
            <HeroCard locale={locale} />
          </Reveal>
        </div>

        {/* Bandeau de chiffres : bornes contractuelles lues dans PRODUITS, jamais une stat marketing. */}
        <StatsBand locale={locale} />
      </div>
    </section>
  );
}
