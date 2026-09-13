"use client";
import Link from "next/link";
import { useState, useEffect } from "react";
import { Menu, X, Globe, ChevronDown, Check } from "lucide-react";
import { Locale, locales, localeLabels, localeTagLabel, t, setPersistedLocale } from "@/lib/i18n";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useSeuilScroll } from "@/lib/motion";

/**
 * Bande du haut — slice 1.
 *
 * Règle non négociable: un écran qui ne fait rien est pire qu'un écran absent. Chaque lien doit
 * donc mener quelque part qui EXISTE. Au stade de la page d'accueil seule, la navigation contient:
 * le mot-marque (accueil), deux ancres vers des sections réelles de la page, et le sélecteur de
 * langue. Pas de lien « Simulateur », « Espace client » ou « Tableau de bord »: ces routes
 * arrivent avec leurs slices, jamais avant.
 */
export default function Header({ locale }: { locale: Locale }) {
  const [open, setOpen] = useState(false);
  // Un booléen, une classe CSS: l'en-tête ne doit pas re-render pendant le scroll.
  const auDessus = useSeuilScroll(12);
  const [langOpen, setLangOpen] = useState(false);
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

  useEffect(() => {
    if (!langOpen) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-lang-dropdown]")) setLangOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setLangOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey as never);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey as never);
    };
  }, [langOpen]);

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

        <div className="hidden lg:flex items-center gap-2 xl:gap-3">
          {/* Langues — liste déroulante compacte. L'étiquette ARIA est l'énumération des codes:
              des codes techniques, pas de la copie (aucune clé « changer de langue » n'existe au
              dictionnaire, et il est interdit d'en écrire une en dur). */}
          <div className="relative" data-lang-dropdown data-testid="lang-dropdown">
            <button
              type="button"
              data-testid="lang-dropdown-trigger"
              onClick={() => setLangOpen(!langOpen)}
              aria-haspopup="listbox"
              aria-expanded={langOpen}
              aria-label="FR / EN / NL / DE"
              className="flex items-center gap-1.5 pl-2.5 pr-2 h-8 rounded-full bg-white/10 border border-white/10 text-white text-[11px] font-bold uppercase hover:bg-white/15 transition backdrop-blur"
            >
              <Globe className="w-3.5 h-3.5 text-white/60 shrink-0" />
              <span className="w-5 text-center leading-none">{locale}</span>
              <ChevronDown className={cn("w-3 h-3 text-white/60 transition-transform shrink-0", langOpen && "rotate-180")} />
            </button>
            {langOpen && (
              <div
                role="listbox"
                data-testid="lang-dropdown-list"
                aria-label="FR / EN / NL / DE"
                className="absolute right-0 top-full mt-2 w-48 rounded-2xl bg-[#1E2028] border border-white/10 shadow-2xl overflow-hidden py-1.5 z-50 motion-menu"
              >
                {locales.map((l) => (
                  <button
                    type="button"
                    key={l}
                    role="option"
                    aria-selected={locale === l}
                    onClick={() => { switchLocale(l); setLangOpen(false); }}
                    className={cn(
                      "w-full flex items-center justify-between px-3 py-2 text-[13px] font-medium transition text-left",
                      locale === l ? "bg-white text-ink font-bold" : "text-white/85 hover:bg-white/10 hover:text-white",
                    )}
                  >
                    <span className="flex items-center gap-2.5">
                      <span className={cn("w-7 h-7 rounded-full grid place-items-center text-[10px] font-extrabold shrink-0", locale === l ? "bg-ink text-white" : "bg-white/10 text-white/90")}>{l.toUpperCase()}</span>
                      <span>{localeLabels[l as Locale]}</span>
                    </span>
                    {locale === l && <Check className="w-4 h-4 shrink-0" />}
                  </button>
                ))}
                {/* Étiquette technique dérivée de la table localeToIntl — jamais recopiée en dur. */}
                <div className="mx-3 mt-1.5 pt-1.5 border-t border-white/10 text-[10px] leading-3 text-white/40 text-center">{localeTagLabel[locale]}</div>
              </div>
            )}
          </div>
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
