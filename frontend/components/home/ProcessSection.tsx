"use client";
import { useState } from "react";
import { Check } from "lucide-react";
import Reveal from "@/components/motion/Reveal";
import { Locale, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Le parcours en quatre étapes — la seule section interactive de la page d'accueil (onglets).
 * Client à cause du useState; le contenu, lui, vient entièrement des dictionnaires.
 * L'onglet actif est un vrai `aria-selected` + bouton au clavier: l'acceptation du brief exige
 * que « onglet actif fonctionne » aussi sans souris.
 */
const ONGLETS = [
  { t: "process.tab1", d: "process.tab1d", h: "process.h1", hd: "process.h1d" },
  { t: "process.tab2", d: "process.tab2d", h: "process.h2", hd: "process.h2d" },
  { t: "process.tab3", d: "process.tab3d", h: "process.h3", hd: "process.h3d" },
  { t: "process.tab4", d: "process.tab4d", h: "process.h4", hd: "process.h4d" },
];

export default function ProcessSection({ locale }: { locale: Locale }) {
  const tr = (k: string) => t(locale, k);
  const [actif, setActif] = useState(0);
  const onglet = ONGLETS[actif];
  return (
    <section id="parcours" className="scroll-mt-24 mx-auto max-w-[1280px] px-6 py-16">
      <div className="text-center">
        <div className="section-title flex justify-center">{tr("process.eyebrow")}</div>
        <h2 className="section-heading">{tr("process.title")}</h2>
        <p className="text-slate-500 mt-2">{tr("process.subtitle")}</p>
      </div>

      <div role="tablist" aria-label={tr("process.title")} className="mt-8 flex flex-wrap justify-center gap-2">
        {ONGLETS.map((tab, i) => (
          <button
            type="button"
            role="tab"
            aria-selected={actif === i}
            key={tab.t}
            onClick={() => setActif(i)}
            className={cn(
              "px-5 py-3 rounded-full text-xs font-bold tracking-widest uppercase border transition active:scale-[.97]",
              actif === i ? "bg-ink text-white border-ink" : "bg-white text-slate-600 border-slate-200 hover:border-ink/20",
            )}
          >
            {tr(tab.t)}
          </button>
        ))}
      </div>

      {/* `key` = l'onglet: le panneau est remonté et l'entrée joue (motion-pop, CSS seul). */}
      <div key={actif} role="tabpanel" className="motion-pop mt-8 grid lg:grid-cols-2 gap-8 items-center bg-white rounded-[24px] border shadow-soft p-6 md:p-8">
        <div>
          <h3 className="text-xl font-extrabold text-ink">{tr(onglet.h)}</h3>
          <p className="mt-3 text-sm leading-6 text-slate-600">{tr(onglet.hd)}</p>
          <ul className="mt-4 space-y-2 text-sm text-slate-600">
            <li className="flex gap-2"><Check className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" aria-hidden="true" /> {tr("process.check1")}</li>
            <li className="flex gap-2"><Check className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" aria-hidden="true" /> {tr("process.check2")}</li>
            <li className="flex gap-2"><Check className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" aria-hidden="true" /> {tr("process.check3")}</li>
          </ul>
        </div>
        <Reveal as="div" variant="right" pas={20} uneFois={false} className="relative h-[260px] rounded-2xl overflow-hidden bg-ink">
          <div className="maillage" aria-hidden="true" />
          <div className="absolute inset-0 grid place-items-center">
            <div className="font-display font-extrabold text-white/90 text-[56px] tracking-tight">{actif + 1}<span className="text-primary">/4</span></div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
