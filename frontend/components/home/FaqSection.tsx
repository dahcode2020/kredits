import { ChevronDown } from "lucide-react";
import Reveal from "@/components/motion/Reveal";
import { Locale, t } from "@/lib/i18n";

/**
 * FAQ de conformité — de vraies <details>, donc ouvertes sans JavaScript (échappatoire noscript)
 * et animées en CSS seul là où `interpolate-size` existe (globals.css).
 *
 * q1/a1 n'est PAS rendue à ce stade: sa copie (« TAEG à partir de, hors assurances ») attend un
 * nombre que seule la slice simulateur pourra fournir proprement — la montrer aujourd'hui
 * afficherait une phrase suspendue, et inventer le nombre serait pire. L'information correspondante
 * est déjà à l'écran (grille de taux + contre-exemple calculé).
 */
const QUESTIONS = [
  { q: "faq.q2", a: "faq.a2" },
  { q: "faq.q3", a: "faq.a3" },
  { q: "faq.q4", a: "faq.a4" },
];

export default function FaqSection({ locale }: { locale: Locale }) {
  const tr = (k: string) => t(locale, k);
  return (
    <section id="faq" className="scroll-mt-24 bg-white py-16 md:py-20">
      <div className="mx-auto max-w-[900px] px-6">
        <Reveal as="h2" variant="fade" className="text-center font-extrabold text-ink text-2xl">{tr("faq.title")}</Reveal>
        <div className="mt-6 space-y-3">
          {/* Le <details> est écrit en toutes lettres dans le JSX: le vérificateur d'imbrication
              (et le parseur HTML du navigateur) doit VOIR la paire details/summary — un composant
              opaque (`Reveal as="details"`) cacherait le parent du <summary>. */}
          {QUESTIONS.map((f, i) => (
            <Reveal as="div" key={f.q} retard={i * 80}>
              <details className="bg-white rounded-2xl border p-5 group open:shadow-soft lift">
                <summary className="flex items-center justify-between cursor-pointer list-none font-bold text-ink text-sm">
                  {tr(f.q)} <ChevronDown className="w-4 h-4 text-slate-400 group-open:rotate-180 transition shrink-0 ml-3" aria-hidden="true" />
                </summary>
                <p className="text-sm leading-6 text-slate-600 mt-3">{tr(f.a)}</p>
              </details>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
