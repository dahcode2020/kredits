import { Locale, locales, t } from "@/lib/i18n";
import { SITE_ORIGIN, SITE_NAME, ogImages } from "@/lib/seo";
import { notFound } from "next/navigation";
import SimulatorPage from "@/components/simulator/SimulatorPage";

/**
 * Simulateur — slice 2. Même contrat que l'accueil :
 * - serveur d'abord : le HTML rendu porte la simulation par défaut (15 000 € / 48 mois, l'exemple
 *   du dictionnaire) — lisible sans JavaScript, indexable, partageable ;
 * - zéro texte en dur (tout vient des dictionnaires, clés statiques pour le scan de parité) ;
 * - zéro donnée fausse : mensualité, TAEG, frais, échéancier, score et documents sortent de
 *   simulateCredit() — les `message` français du moteur ne sont JAMAIS rendus (ce sont des logs
 *   backend), l'UI interpolé les clés `credit:simulator.warning.*` ;
 * - pas de CTA « Déposer ma demande » : la route demande pré-remplie est la slice 3, elle
 *   apparaîtra avec elle (un bouton sans destination est pire qu'un bouton absent).
 */
export function generateMetadata({ params }: { params: { locale: string } }) {
  const locale = (locales as readonly string[]).includes(params.locale) ? (params.locale as Locale) : "fr";
  const titre = `${t(locale, "credit:simulator.title")} | ${SITE_NAME}`;
  const description = t(locale, "common:seo.shortcut.simulator.description");
  const chemin = `/${locale}/credit/simulator`;
  return {
    metadataBase: new URL(SITE_ORIGIN),
    title: { absolute: titre },
    description,
    alternates: {
      canonical: chemin,
      languages: Object.fromEntries(locales.map((l) => [l, `/${l}/credit/simulator`])),
    },
    openGraph: {
      title: titre,
      description,
      url: `${SITE_ORIGIN}${chemin}`,
      siteName: SITE_NAME,
      type: "website",
      images: ogImages,
    },
    robots: { index: true, follow: true },
  };
}

export default function SimulatorRoute({ params }: { params: { locale: string } }) {
  if (!(locales as readonly string[]).includes(params.locale)) notFound();
  const locale = params.locale as Locale;
  return <SimulatorPage locale={locale} />;
}
