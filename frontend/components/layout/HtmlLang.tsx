"use client";
import { useEffect } from "react";
import { Locale, localeDir, localeToIntl } from "@/lib/i18n";

/**
 * Applique `lang`, `dir` et la locale Intl sur <html> après hydratation.
 *
 * Le <html> est rendu par `app/layout.tsx`, qui ne reçoit PAS les params du segment
 * `[locale]` (vérifié en Next 14.2 : `params === {}`) → la langue y est figée.
 * Muter ces attributs dans un effect garde le DOM cohérent (lecteurs d'écran,
 * indexation, `:lang()`) sans jamais créer d'écart HTML serveur / premier rendu client.
 */
export default function HtmlLang({ locale }: { locale: Locale }) {
  useEffect(() => {
    const el = document.documentElement;
    el.lang = locale;
    el.dir = localeDir[locale] ?? "ltr";
    el.dataset.locale = locale;
    el.dataset.intl = localeToIntl[locale];
  }, [locale]);
  return null;
}

/**
 * Variante exécutée pendant le parsing du document (avant hydratation) : corrige
 * `lang` dès le premier paint pour un chargement complet. Locale issue de l'enum validée,
 * donc aucun risque d'injection. `suppressHydrationWarning` sur <html> couvre cette mutation.
 */
export function HtmlLangScript({ locale }: { locale: Locale }) {
  const dir = localeDir[locale] ?? "ltr";
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `(function(d,l){d.documentElement.lang=l;d.documentElement.dir="${dir}";d.documentElement.dataset.locale=l;})(document,"${locale}");`,
      }}
    />
  );
}
