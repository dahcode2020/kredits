import ScrollProgress from "@/components/motion/ScrollProgress";
import SWRegister from "@/components/pwa/SWRegister";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import HtmlLang, { HtmlLangScript } from "@/components/layout/HtmlLang";
import { Locale, locales, defaultLocale, openGraphLocale, t } from "@/lib/i18n";
import { SITE_ORIGIN, SITE_NAME, ogImages } from "@/lib/seo";
import { notFound } from "next/navigation";

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

/**
 * Métadonnées par langue — dérivées du segment `[locale]`, jamais d'une valeur par défaut.
 *
 * Le layout racine ne reçoit pas les params: y écrire `canonical: "/fr"` ou `locale: "fr_BE"`
 * enverrait le même canonical aux quatre langues (canonicalisation croisée = /en, /nl, /de écartés
 * de l'index) et un `og:locale` que le parseur Open Graph refuse. `openGraphLocale` (lib/i18n.ts)
 * fournit le tag reconnu, un seul endroit. La copie (titre, description) passe par les
 * dictionnaires — zéro texte en dur, y compris « hors React ».
 */
export function generateMetadata({ params }: { params: { locale: string } }) {
  const locale = (locales as readonly string[]).includes(params.locale) ? (params.locale as Locale) : defaultLocale;
  const seoTitle = t(locale, "common:seo.title");
  const seoDescription = t(locale, "common:seo.description");
  return {
    metadataBase: new URL(SITE_ORIGIN),
    // `absolute` (et non `default`): le motif `%s | KREDIT` du layout racine produirait
    // « KREDIT — … | KREDIT », un doublon de marque.
    title: { absolute: seoTitle },
    description: seoDescription,
    alternates: {
      canonical: `/${locale}`,
      // hreflang: chaque langue pointe sa propre racine, plus `x-default` vers la locale par défaut.
      languages: Object.fromEntries([...locales.map((l) => [l, `/${l}`]), ["x-default", `/${defaultLocale}`]]),
    },
    // Bloc **complet**: Next remplace `openGraph` au lieu de le fusionner, donc une déclaration
    // partielle ferait disparaître `og:image`, `og:site_name` et `og:type`.
    openGraph: {
      title: seoTitle,
      description: seoDescription,
      url: `${SITE_ORIGIN}/${locale}`,
      siteName: SITE_NAME,
      type: "website",
      locale: openGraphLocale[locale],
      alternateLocales: locales.filter((l) => l !== locale).map((l) => openGraphLocale[l]),
      images: ogImages,
    },
    twitter: {
      card: "summary_large_image",
      title: seoTitle,
      description: seoDescription,
      images: ["/icons/icon-512.png"],
    },
    robots: { index: true, follow: true },
  };
}

export default function LocaleLayout({ children, params }: { children: React.ReactNode; params: { locale: string } }) {
  // Une locale inconnue dans l'URL n'est jamais « réparée » en français silencieusement: elle
  // produit un vrai 404 traduit (app/[locale]/not-found.tsx), avec les quatre langues en sortie.
  if (!(locales as readonly string[]).includes(params.locale)) notFound();
  const locale = params.locale as Locale;
  return (
    <>
      {/* <html lang>/<dir>: corrigé au parsing (chargement complet) puis à chaque navigation (HtmlLang) */}
      <HtmlLangScript locale={locale} />
      <HtmlLang locale={locale} />
      {/* Skip-link: premier nœud focusable du document, donc avant l'en-tête. Son libellé vient du
          dictionnaire (il était en dur dans `app/layout.tsx`, français sur les quatre marchés). */}
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 bg-ink text-white px-4 py-2 rounded-full z-[100]">
        {t(locale, "common:shell.skipToContent")}
      </a>
      {/* Barre de lecture: position:fixed, donc sa place dans l'ordre du DOM n'a pas d'effet
          visuel; elle est posée juste avant l'en-tête pour rester une feuille isolée, hors du main. */}
      <ScrollProgress />
      <SWRegister locale={locale} />
      <Header locale={locale} />
      <main id="main" className="pt-[72px] min-h-[60vh]">{children}</main>
      <Footer locale={locale} />
    </>
  );
}
