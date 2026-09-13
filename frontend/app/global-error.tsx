"use client";
import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Locale, locales, t } from "@/lib/i18n";
import { buttonClasses } from "@/components/ui/Button";

/**
 * Dernière frontière : elle remplace **tout** le document quand le layout racine lui-même
 * tombe (police, metadata, chrome PWA). Elle doit donc rendre `<html>` et `<body>` elle-même,
 * sinon le navigateur hérite d'un fragment sans racine et affiche une page vide.
 *
 * Comme `app/[locale]/error.tsx`, elle se passe de store et de contexte : la locale est relue
 * dans le chemin, avec repli `fr`. C'est le seul endroit du dépôt où le `<html>` est rendu hors
 * de `app/layout.tsx`, d'où le `lang` explicite (le scanner de cohérence html lang ↔ locale ne
 * voit pas ce fichier, il ne rend pas `suppressHydrationWarning` pour rien).
 */
function localeDepuisChemin(pathname: string | null): Locale {
  const segment = (pathname ?? "").split("/")[1];
  return (locales as readonly string[]).includes(segment) ? (segment as Locale) : "fr";
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const locale = localeDepuisChemin(usePathname());
  const tr = (cle: string) => t(locale, `common:${cle}`);

  useEffect(() => {
    console.error("[kredit] fatal render error:", error);
  }, [error]);

  return (
    <html lang={locale}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>KREDIT</title>
      </head>
      {/* Rendu intégralement statique: pas de `suppressHydrationWarning` ici, la règle
          `hydration-bandaid` du dépôt le refuse — ce panneau ne lit ni store, ni thème, ni
          attribut posé par une extension, donc il ne peut pas diverger entre serveur et client. */}
      <body className="bg-white text-ink antialiased">
        <main className="mx-auto max-w-xl px-6 py-24">
          <section role="alert" aria-live="assertive">
            <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-primary">KREDIT</p>
            <h1 className="mt-3 text-2xl font-extrabold text-ink">{tr("shell.errorGlobalTitle")}</h1>
            <p className="mt-2 text-[15px] leading-relaxed text-slate-600">{tr("shell.errorGlobalBody")}</p>
            {process.env.NODE_ENV !== "production" && error.message ? (
              <pre className="mt-5 overflow-x-auto rounded-lg bg-slate-50 p-3 text-[12px] leading-relaxed text-slate-700">
                {`${error.message}${error.digest ? `\n[digest] ${error.digest}` : ""}`}
              </pre>
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
        </main>
      </body>
    </html>
  );
}
