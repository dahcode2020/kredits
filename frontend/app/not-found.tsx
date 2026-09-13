import { cookies } from "next/headers";
import Link from "next/link";
import { Locale, locales, t } from "@/lib/i18n";
import { LOCALE_COOKIE, isSupportedLocale } from "@/lib/locale-detection";
import { buttonClasses } from "@/components/ui/Button";

/**
 * Route inconnue **hors** de toute page du dépôt — donc rendue hors du segment `[locale]`, sans
 * bandeau ni pied de page. Sans ce fichier, Next sert sa page 404 intégrée : une phrase anglaise,
 * aucun moyen d'en sortir, sur un site qui se revendique FR/EN/NL/DE. Vue depuis le navigateur,
 * cette page blanche à moitié traduite est indistinguable d'un plantage.
 *
 * Composant serveur : `not-found.tsx` de la racine ne reçoit ni params ni pathname, donc la langue
 * vient du cookie posé par le sélecteur d'ambiance (`NEXT_LOCALE`), avec repli `fr`. Aucun `usePathname`
 * ici — et donc aucun écart serveur/client possible.
 */
export default function RootNotFound() {
  const brut = cookies().get(LOCALE_COOKIE)?.value;
  const locale: Locale = isSupportedLocale(brut) ? brut : "fr";
  const tr = (cle: string) => t(locale, `common:${cle}`);
  return (
    <main lang={locale} className="min-h-screen bg-white px-6 py-24 text-ink">
      <div className="mx-auto max-w-xl">
        <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-primary">404</p>
        <h1 className="mt-3 text-2xl font-extrabold">{tr("shell.notFoundTitle")}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-slate-600">{tr("shell.notFoundRoot")}</p>
        <p className="mt-1 text-[15px] leading-relaxed text-slate-600">{tr("shell.notFoundBody")}</p>
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Link href={`/${locale}`} className={buttonClasses("primary", "md")}>
            {tr("shell.notFoundHome")}
          </Link>
        </div>
        <nav aria-label={tr("shell.notFoundOther")} className="mt-6 flex items-center gap-3">
          <span className="text-[13px] font-semibold text-slate-500">{tr("shell.notFoundOther")}</span>
          {(locales as readonly Locale[]).map((l) => (
            <Link key={l} href={`/${l}`} className="text-[13px] font-bold uppercase text-slate-500 hover:text-primary">
              {l}
            </Link>
          ))}
        </nav>
      </div>
    </main>
  );
}
