"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Locale, locales, t } from "@/lib/i18n";
import { buttonClasses } from "@/components/ui/Button";

/**
 * Route inconnue **dans** le segment localisé : ce panneau est rendu à l'intérieur de
 * `app/[locale]/layout.tsx`, donc le bandeau et le pied de page restent en place — la page ne
 * « disparaît » plus, elle explique. La locale est relue dans le chemin (aucun store ici).
 */
function localeDepuisChemin(pathname: string | null): Locale {
  const segment = (pathname ?? "").split("/")[1];
  return (locales as readonly string[]).includes(segment) ? (segment as Locale) : "fr";
}

export default function NotFound() {
  const locale = localeDepuisChemin(usePathname());
  const tr = (cle: string) => t(locale, `common:${cle}`);
  return (
    <section className="mx-auto max-w-xl px-6 py-24">
      <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-primary">404</p>
      <h1 className="mt-3 text-2xl font-extrabold text-ink">{tr("shell.notFoundTitle")}</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-slate-600">{tr("shell.notFoundBody")}</p>
      <div className="mt-7 flex flex-wrap items-center gap-3">
        <Link href={`/${locale}`} className={buttonClasses("primary", "md")}>
          {tr("shell.notFoundHome")}
        </Link>
        <nav aria-label={tr("shell.notFoundOther")} className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-slate-500">{tr("shell.notFoundOther")}</span>
          {(locales as readonly Locale[]).map((l) => (
            <Link
              key={l}
              href={`/${l}`}
              aria-current={l === locale ? "page" : undefined}
              className="text-[13px] font-bold uppercase text-slate-500 hover:text-primary"
            >
              {l}
            </Link>
          ))}
        </nav>
      </div>
    </section>
  );
}
