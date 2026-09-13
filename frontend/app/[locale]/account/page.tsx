import { Locale, locales, t } from "@/lib/i18n";
import { SITE_ORIGIN, SITE_NAME, ogImages } from "@/lib/seo";
import { notFound } from "next/navigation";
import DashboardPage from "@/components/auth/DashboardPage";

/**
 * Espace connecté — slices 4 & 5 : après connexion/inscription, le tableau de bord client
 * (aperçu néo-banque, demandes, échéanciers projetés, paiements, documents, préférences de
 * notification, profil & sécurité). Tout vient des données locales réelles ou de projections
 * étiquetées — rien d'inventé.
 */
export function generateMetadata({ params }: { params: { locale: string } }) {
  const locale = (locales as readonly string[]).includes(params.locale) ? (params.locale as Locale) : "fr";
  const titre = `${t(locale, "account.title")} | ${SITE_NAME}`;
  const description = t(locale, "account.nextSlice");
  const chemin = `/${locale}/account`;
  return {
    metadataBase: new URL(SITE_ORIGIN),
    title: { absolute: titre },
    description,
    alternates: { canonical: chemin, languages: Object.fromEntries(locales.map((l) => [l, `/${l}/account`])) },
    openGraph: { title: titre, description, url: `${SITE_ORIGIN}${chemin}`, siteName: SITE_NAME, type: "website", images: ogImages },
    robots: { index: false, follow: true },
  };
}

export default function AccountRoute({ params }: { params: { locale: string } }) {
  if (!(locales as readonly string[]).includes(params.locale)) notFound();
  return <DashboardPage locale={params.locale as Locale} />;
}
