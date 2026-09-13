import { Locale, locales, t } from "@/lib/i18n";
import { SITE_ORIGIN, SITE_NAME, ogImages } from "@/lib/seo";
import { notFound } from "next/navigation";
import { etatDepuisQuery } from "@/lib/application";
import ApplyPage from "@/components/simulator/ApplyPage";

/* La query EST le contenu : chaque URL porte sa simulation pré-remplie, rendue côté serveur. */
export const dynamic = "force-dynamic";

/**
 * Demande pré-remplie — slice 3.
 *
 * Page DYNAMIQUE à dessein : `searchParams` opte hors du SSG pour que le HTML rendu côté serveur
 * porte DÉJÀ la simulation reprise du simulateur (montant, durée, produit… validés et bornés par
 * `etatDepuisQuery`). Une URL bricolée ne produit rien hors grille ; sans query, l'exemple par
 * défaut. Lisible sans JavaScript (le formulaire s'affiche pré-rempli), indexable, partageable.
 *
 * Persistance honnête : sans backend, la demande déposée est conservée sur l'appareil
 * (localStorage) et l'écran le dit — aucune donnée « envoyée » en silence.
 */
export function generateMetadata({ params }: { params: { locale: string } }) {
  const locale = (locales as readonly string[]).includes(params.locale) ? (params.locale as Locale) : "fr";
  const titre = `${t(locale, "credit:simulator.request")} | ${SITE_NAME}`;
  const description = t(locale, "credit:application.newSub");
  const chemin = `/${locale}/credit/apply`;
  return {
    metadataBase: new URL(SITE_ORIGIN),
    title: { absolute: titre },
    description,
    alternates: {
      canonical: chemin,
      languages: Object.fromEntries(locales.map((l) => [l, `/${l}/credit/apply`])),
    },
    openGraph: {
      title: titre,
      description,
      url: `${SITE_ORIGIN}${chemin}`,
      siteName: SITE_NAME,
      type: "website",
      images: ogImages,
    },
    robots: { index: false, follow: true },
  };
}

export default function ApplyRoute({
  params,
  searchParams,
}: {
  params: { locale: string };
  searchParams: Record<string, string | undefined>;
}) {
  if (!(locales as readonly string[]).includes(params.locale)) notFound();
  const locale = params.locale as Locale;
  return <ApplyPage locale={locale} initial={etatDepuisQuery(searchParams)} />;
}
