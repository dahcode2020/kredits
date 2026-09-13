import { Lock, Scale, Clock, Fingerprint, FileCheck, Bell } from "lucide-react";
import Reveal from "@/components/motion/Reveal";
import { Locale, t } from "@/lib/i18n";

/**
 * Six engagements — copie des dictionnaires (`services.*`), icônes lucide, halo qui suit le
 * pointeur sur les navigateurs qui en ont un (`.spot`, éteint sous `hover: none`).
 */
const SERVICES = [
  { icon: Lock, titleKey: "services.secure.t", descKey: "services.secure.d" },
  { icon: Scale, titleKey: "services.compliant.t", descKey: "services.compliant.d" },
  { icon: Clock, titleKey: "services.fast.t", descKey: "services.fast.d" },
  { icon: Fingerprint, titleKey: "services.config.t", descKey: "services.config.d" },
  { icon: FileCheck, titleKey: "services.transparent.t", descKey: "services.transparent.d" },
  { icon: Bell, titleKey: "services.notify.t", descKey: "services.notify.d" },
];

export default function ServicesSection({ locale }: { locale: Locale }) {
  const tr = (k: string) => t(locale, k);
  return (
    <section id="services" className="scroll-mt-24 bg-ink text-white py-16 md:py-24 relative overflow-hidden">
      <div className="maillage opacity-30" aria-hidden="true" />
      <div className="relative mx-auto max-w-[1280px] px-6">
        <div className="text-center max-w-2xl mx-auto">
          <div className="text-primary text-[13px] tracking-[0.18em] font-bold uppercase">{tr("services.title")}</div>
          <h2 className="text-[32px] md:text-[36px] font-extrabold mt-2">{tr("services.subtitle")}</h2>
        </div>
        <div className="mt-10 grid md:grid-cols-3 gap-6">
          {SERVICES.map((s, i) => (
            <Reveal as="div" key={s.titleKey} retard={i * 70} variant="scale" spotlight className="bg-white/[0.04] border border-white/10 rounded-[20px] p-6 lift">
              <div className="w-11 h-11 rounded-xl bg-primary grid place-items-center"><s.icon className="w-5 h-5 text-white" aria-hidden="true" /></div>
              <h3 className="mt-4 font-bold text-white">{tr(s.titleKey)}</h3>
              <p className="mt-1 text-sm leading-6 text-white/60">{tr(s.descKey)}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
