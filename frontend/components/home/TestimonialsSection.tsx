import { Quote } from "lucide-react";
import Reveal from "@/components/motion/Reveal";
import { Locale, t } from "@/lib/i18n";

/**
 * Témoignages — rendus tels que les dictionnaires les portent, c'est-à-dire EXPLICITEMENT
 * illustratifs: `testimonials.note` (« Avis illustratifs — collecte réelle soumise à vérification
 * et consentement RGPD ») est affiché sous la grille. Pas d'étoiles, pas de badge « client
 * vérifié », pas de photo de banque d'images présentée comme un vrai client: ce serait précisément
 * la « donnée fausse » que le brief interdit.
 */
const TEMOINS = [
  { q: "testimonials.q1", a: "testimonials.a1" },
  { q: "testimonials.q2", a: "testimonials.a2" },
  { q: "testimonials.q3", a: "testimonials.a3" },
];

export default function TestimonialsSection({ locale }: { locale: Locale }) {
  const tr = (k: string) => t(locale, k);
  return (
    <section className="relative py-16 md:py-24 bg-surface overflow-hidden">
      <div className="mx-auto max-w-[1280px] px-6">
        <Reveal as="div" variant="fade" className="text-center">
          <div className="text-primary text-[13px] tracking-[0.18em] font-bold uppercase">{tr("testimonials.title")}</div>
          <h2 className="text-[32px] font-extrabold mt-2 text-ink">{tr("testimonials.sub")}</h2>
        </Reveal>
        <div className="mt-8 grid md:grid-cols-3 gap-6">
          {TEMOINS.map((tes, i) => {
            const auteur = tr(tes.a);
            return (
              <Reveal as="div" key={tes.a} retard={i * 110} variant="rise" className="bg-white rounded-2xl p-6 shadow-card lift">
                <Quote className="w-6 h-6 text-primary/30" aria-hidden="true" />
                <p className="text-sm leading-6 text-slate-700 mt-2">“{tr(tes.q)}”</p>
                <div className="mt-4 flex items-center gap-3">
                  {/* Initiales dérivées du libellé traduit — décoratives, jamais une identité. */}
                  <span aria-hidden="true" className="w-9 h-9 rounded-full bg-primary-light text-primary grid place-items-center font-extrabold text-sm">
                    {auteur.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="text-sm font-bold text-ink">{auteur}</div>
                </div>
              </Reveal>
            );
          })}
        </div>
        <p className="text-center text-[11px] text-slate-500 mt-6">{tr("testimonials.note")}</p>
      </div>
    </section>
  );
}
