import { Check, Award } from "lucide-react";
import Reveal from "@/components/motion/Reveal";
import { Locale, gdprAcronym, t } from "@/lib/i18n";

/**
 * « À propos » — copie des dictionnaires, visuel CSS (maillage) plutôt qu'une photo d'illustration
 * présentée comme l'équipe réelle. La carte conformité lit ses trois lignes du dictionnaire; le
 * sigle RGPD vient de la table par locale (lib/i18n.ts), pas du JSX.
 */
export default function AboutSection({ locale }: { locale: Locale }) {
  const tr = (k: string) => t(locale, k);
  return (
    <section id="apropos" className="scroll-mt-24 mx-auto max-w-[1280px] px-6 py-16 md:py-24">
      <div className="grid lg:grid-cols-2 gap-10 items-start">
        <div>
          <Reveal as="div" className="section-title">{tr("about.eyebrow")}</Reveal>
          <Reveal as="h2" retard={80} className="section-heading mt-2">{tr("about.title")}</Reveal>
          <Reveal as="p" retard={150} className="mt-4 text-[15px] leading-7 text-slate-600">{tr("about.p1")}</Reveal>
          <Reveal as="p" retard={210} className="mt-4 text-[15px] leading-7 text-slate-600">{tr("about.p2")}</Reveal>
          <ul className="mt-6 space-y-3">
            {["aboutCheck.1", "aboutCheck.2", "aboutCheck.3"].map((li, i) => (
              <Reveal as="li" key={li} retard={280 + i * 80} variant="left" className="flex gap-3 text-sm">
                <span className="mt-0.5 w-6 h-6 rounded-full bg-primary/10 text-primary grid place-items-center shrink-0"><Check className="w-3.5 h-3.5" aria-hidden="true" /></span>
                <span className="text-slate-700">{tr(li)}</span>
              </Reveal>
            ))}
          </ul>
          <Reveal as="div" retard={520} className="mt-6 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-ink text-white text-xs font-bold tracking-widest uppercase">
            <Award className="w-4 h-4 text-primary" aria-hidden="true" /> {tr("about.badge")}
          </Reveal>
        </div>

        <div className="relative">
          {/* Panneau décoratif: dégradés animés (kreditDrive), aucune image mensongère. */}
          <Reveal as="div" variant="right" pas={24} className="relative h-[420px] rounded-[24px] overflow-hidden bg-ink shadow-card">
            <div className="maillage" aria-hidden="true" />
            <div className="absolute inset-0 grid place-items-center">
              <div className="text-center">
                <div className="font-display font-extrabold text-white text-[88px] leading-none tracking-tight">BE</div>
                <div className="mt-2 text-[11px] tracking-widest uppercase font-bold text-white/70">{tr("compliance.pilot")}</div>
              </div>
            </div>
          </Reveal>
          <Reveal as="div" retard={200} className="mt-4 bg-white rounded-2xl shadow-card border p-5">
            <div className="text-xs tracking-widest uppercase font-bold text-slate-500">{tr("compliance.title")}</div>
            <div className="mt-2 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">KYC/AML</span><span className="font-bold text-emerald-600">{tr("compliance.active")}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">{gdprAcronym[locale]}</span><span className="font-bold text-emerald-600">{tr("compliance.active")}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">{tr("compliance.audit")}</span><span className="font-bold text-emerald-600">{tr("compliance.immutable")}</span></div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
