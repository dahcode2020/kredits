import { Locale, locales } from "@/lib/i18n";
import { notFound } from "next/navigation";
import Hero from "@/components/home/Hero";
import ProductSection from "@/components/home/ProductSection";
import AboutSection from "@/components/home/AboutSection";
import ProcessSection from "@/components/home/ProcessSection";
import ServicesSection from "@/components/home/ServicesSection";
import CtaBand from "@/components/home/CtaBand";
import TestimonialsSection from "@/components/home/TestimonialsSection";
import FaqSection from "@/components/home/FaqSection";
import ContactSection from "@/components/home/ContactSection";

/**
 * Page d'accueil — slice 1, périmètre: UNE page, 4 langues, animée, zéro donnée fausse.
 *
 * Composant serveur: tout le texte est rendu par le serveur dans la langue du segment
 * (indexation, partage, HTML sans JavaScript). Ce que cette page contient, et surtout ce qu'elle
 * ne contient PAS:
 * - les nombres viennent de lib/credit-engine.ts (paliers, plafonds, taux plancher, contre-exemple
 *   TAEG calculé) — jamais du JSX, jamais des dictionnaires;
 * - le texte vient des dictionnaires i18n (11 namespaces × 4 langues, parité verrouillée en CI);
 * - aucun CTA vers une route qui n'existe pas encore: le simulateur (slice 2), le portail
 *   (slice 3) et leurs boutons arriveront en même temps que leurs écrans — un écran qui ne fait
 *   rien est pire qu'un écran absent;
 * - pas de statistiques marketing inventées (clients, dossiers, avis): les clés `stats.*` et
 *   `trust.*` existent au dictionnaire mais restent non rendues tant qu'aucune donnée réelle ne
 *   peut les porter.
 */
export default function HomePage({ params }: { params: { locale: string } }) {
  if (!(locales as readonly string[]).includes(params.locale)) notFound();
  const locale = params.locale as Locale;
  return (
    <div className="bg-white">
      <Hero locale={locale} />
      <ProductSection locale={locale} />
      <AboutSection locale={locale} />
      <ProcessSection locale={locale} />
      <ServicesSection locale={locale} />
      <CtaBand locale={locale} />
      <TestimonialsSection locale={locale} />
      <FaqSection locale={locale} />
      <ContactSection locale={locale} />
    </div>
  );
}
