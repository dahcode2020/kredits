"use client";
import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Locale, locales, t } from "@/lib/i18n";
import { buttonClasses } from "@/components/ui/Button";

/**
 * Frontière d'erreur du segment `[locale]`.
 *
 * Sans `error.tsx`, une exception levée côté client (dans un effet, un handler, un store)
 * fait démontar **l'arbre React entier** par React 18 : la page s'affiche puis devient
 * blanche — rien n'indique au visiteur ce qui s'est passé ni comment en sortir, et en
 * production l'overlay de dev n'existe même pas. Ce fichier transforme la panne blanche en
 * panneau local, avec `reset()` (re-render du segment) et un repli vers l'accueil.
 *
 * La locale est relue dans l'URL, pas dans un store : la frontière doit rester debout quand
 * le reste de l'application est justement en train de tomber. `usePathname` est déterministe
 * entre le rendu serveur et le rendu client, donc ce panneau ne peut pas créer de mismatch.
 */
function localeDepuisChemin(pathname: string | null): Locale {
  const segment = (pathname ?? "").split("/")[1];
  return (locales as readonly string[]).includes(segment) ? (segment as Locale) : "fr";
}

export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const locale = localeDepuisChemin(usePathname());
  const tr = (cle: string) => t(locale, `common:${cle}`);

  useEffect(() => {
    // Le détail complet reste dans la console (et dans l'overlay en dev) ; le panneau, lui,
    // n'affiche jamais de texte technique brut sur les quatre marchés.
    console.error("[kredit] render error:", error);
  }, [error]);

  return (
    <section className="mx-auto max-w-xl px-6 py-24" role="alert" aria-live="assertive">
      <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-primary">KREDIT</p>
      <h1 className="mt-3 text-2xl font-extrabold text-ink">{tr("shell.errorTitle")}</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-slate-600">{tr("shell.errorBody")}</p>
      {process.env.NODE_ENV !== "production" && error.message ? (
        <div className="mt-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
            {tr("shell.errorDevHint")}
          </p>
          <pre className="mt-1 overflow-x-auto rounded-lg bg-slate-50 p-3 text-[12px] leading-relaxed text-slate-700">
            {`${error.message}${error.digest ? `\n[digest] ${error.digest}` : ""}`}
          </pre>
        </div>
      ) : null}
      <div className="mt-7 flex flex-wrap gap-3">
        <button type="button" onClick={reset} className={buttonClasses("primary", "md")}>
          {tr("shell.errorRetry")}
        </button>
        <Link href={`/${locale}`} className={buttonClasses("outline", "md")}>
          {tr("shell.errorHome")}
        </Link>
      </div>
    </section>
  );
}
