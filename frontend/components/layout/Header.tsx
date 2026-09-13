"use client";
import Link from "next/link";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { Locale, locales, localeLabels, localeTagLabel, t, setPersistedLocale } from "@/lib/i18n";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useSeuilScroll } from "@/lib/motion";

/**
 * Bande du haut — slice 1 (+ habillage Dewi).
 *
 * Règle non négociable: un écran qui ne fait rien est pire qu'un écran absent. Chaque lien doit
 * donc mener quelque part qui EXISTE. Au stade de la page d'accueil seule, la navigation contient:
 * le mot-marque (accueil), deux ancres vers des sections réelles de la page, et le sélecteur de
 * langue — en pilules visibles sur desktop (façon Dewi), en boutons dans le panneau mobile.
 * Pas de lien « Simulateur », « Espace client » ou « Tableau de bord »: ces routes arrivent avec
 * leurs slices, jamais avant.
 */
export default function Header({ locale }: { locale: Locale }) {
  const [open, setOpen] = useState(false);
  // Un booléen, une classe CSS: l'en-tête ne doit pas re-render pendant le scroll.
  const auDessus = useSeuilScroll(12);
  const router = useRouter();
  const pathname = usePathname();

  const switchLocale = (l: Locale) => {
    // Persistance: uniquement ici (handler), jamais au render.
    setPersistedLocale(l);
    const parts = pathname.split("/");
    parts[1] = l;
    router.push(parts.join("/") || `/${l}`);
  };
  const tr = (k: string) => t(locale, k);

  // Les deux ancres réelles de la slice 1 — déclarées une fois, réutilisées par le menu mobile.
  const ancres = [
    { href: `/${locale}#produits`, label: tr("nav.products") },
    { href: `/${locale}#apropos`, label: tr("nav.about") },
  ];

  return (
    <header
      data-scrolled={auDessus ? "true" : "false"}
      className="header-elevate fixed top-0 inset-x-0 z-50 bg-ink/95 backdrop-blur border-b border-white/5"
    >
      <div className="mx-auto max-w-[1280px] px-6 h-[72px] flex items-center justify-between">
        <Link href={`/${locale}`} className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center text-white font-extrabold text-sm">K</div>
          <span className="text-white font-display font-extrabold tracking-tight text-[22px]">KREDIT<span className="text-primary">.</span></span>
          <span className="hidden md:inline-flex items-center ml-2 px-2.5 py-1 rounded-full bg-white/10 text-white/80 text-[10px] font-bold tracking-widest uppercase border border-white/10">
            BE • EUR
          </span>
        </Link>

        <nav className="hidden lg:flex items-center gap-5 xl:gap-6">
          {ancres.map((a) => (
            <Link key={a.href} href={a.href} className="nav-link whitespace-nowrap">{a.label}</Link>
          ))}
        </nav>

        {/* Langues — pilules visibles sur desktop. Les codes FR/EN/NL/DE sont des étiquettes
            techniques (jamais de la copie), d'où l'aria-label d'énumération; le libellé plein de
            chaque langue reste celui du dictionnaire (attribut title, survol clavier inclus). */}
        <div
          className="hidden lg:flex items-center gap-1 rounded-full bg-white/5 border border-white/10 p-1 backdrop-blur"
          role="group"
          aria-label="FR / EN / NL / DE"
          data-testid="lang-pills"
        >
          {locales.map((l) => (
            <button
              type="button"
              key={l}
              onClick={() => switchLocale(l)}
              aria-pressed={locale === l}
              title={`${localeLabels[l as Locale]} — ${localeTagLabel[l as Locale]}`}
              className={cn(
                "h-7 px-2.5 rounded-full text-[11px] font-extrabold uppercase transition",
                locale === l ? "bg-primary text-white" : "text-white/60 hover:text-white hover:bg-white/10",
              )}
            >
              {l}
            </button>
          ))}
        </div>

        {/* Burger mobile */}
        <button
          type="button"
          className="lg:hidden w-10 h-10 grid place-items-center rounded-xl text-white border border-white/10 bg-white/10"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label="Menu"
        >
          {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Panneau mobile — rendu conditionnellement, entrée animée par le CSS seul (motion-menu). */}
      {open && (
        <div className="lg:hidden border-t border-white/10 bg-ink/98 backdrop-blur motion-menu">
          <nav className="mx-auto max-w-[1280px] px-6 py-4 flex flex-col gap-1">
            {ancres.map((a) => (
              <Link key={a.href} href={a.href} onClick={() => setOpen(false)} className="py-2.5 text-white/85 hover:text-white text-sm font-bold tracking-widest uppercase">
                {a.label}
              </Link>
            ))}
            <div className="mt-2 pt-3 border-t border-white/10 grid grid-cols-4 gap-2">
              {locales.map((l) => (
                <button
                  type="button"
                  key={l}
                  onClick={() => { switchLocale(l); setOpen(false); }}
                  aria-pressed={locale === l}
                  className={cn(
                    "h-9 rounded-full text-[11px] font-extrabold uppercase border transition",
                    locale === l ? "bg-primary border-primary text-white" : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10",
                  )}
                >
                  {l}
                </button>
              ))}
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
