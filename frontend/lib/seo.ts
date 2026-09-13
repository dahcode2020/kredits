/**
 * Morceaux de métadonnées partagés entre le layout racine et le layout `[locale]`.
 *
 * Pourquoi ce module: Next ne **fusionne** pas `openGraph` entre parent et enfant — dès que
 * l'enfant déclare `openGraph`, le bloc du parent est remplacé. Tout ce qui doit rester vrai pour
 * les quatre langues (image sociale, nom du site) est donc défini **une fois** ici, consommé par
 * `app/[locale]/layout.tsx`, et le layout racine ne garde que ce qui ne dépend pas de la locale.
 */
export const SITE_ORIGIN = "https://kredit.be";

export const SITE_NAME = "KREDIT";

/** Image sociale: URL absolue (les scrapers ne résolvent pas `metadataBase` pour `og:image`). */
export const ogImages = [{ url: `${SITE_ORIGIN}/icons/icon-512.png`, width: 512, height: 512, alt: "KREDIT" }];
