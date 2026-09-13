import { Locale, locales, t } from "@/lib/i18n";
import { SITE_ORIGIN, SITE_NAME, ogImages } from "@/lib/seo";
import { notFound } from "next/navigation";
import AuthPage from "@/components/auth/AuthPage";

/**
 * Authentification — slice 4. Une seule page pour se connecter OU s'inscrire, et pour les trois
 * profils (CUSTOMER / ADMIN / SUPER_ADMIN), comme exigé. Démonstration locale sans backend :
 * comptes et session en localStorage, mots de passe empreintés SHA-256, et l'écran le dit.
 */
export function generateMetadata({ params }: { params: { locale: string } }) {
  const locale = (locales as readonly string[]).includes(params.locale) ? (params.locale as Locale) : "fr";
  const titre = `${t(locale, "nav.login")} | ${SITE_NAME}`;
  const description = t(locale, "auth.loginTitle");
  const chemin = `/${locale}/auth`;
  return {
    metadataBase: new URL(SITE_ORIGIN),
    title: { absolute: titre },
    description,
    alternates: { canonical: chemin, languages: Object.fromEntries(locales.map((l) => [l, `/${l}/auth`])) },
    openGraph: { title: titre, description, url: `${SITE_ORIGIN}${chemin}`, siteName: SITE_NAME, type: "website", images: ogImages },
    robots: { index: false, follow: true },
  };
}

export default function AuthRoute({ params }: { params: { locale: string } }) {
  if (!(locales as readonly string[]).includes(params.locale)) notFound();
  return <AuthPage locale={params.locale as Locale} />;
}
