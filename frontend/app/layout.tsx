import "./globals.css";

export const metadata = {
  title: {
    // Pas de `default` ici: le titre du site est une copie à traduire, donc fournie par
    // `app/[locale]/layout.tsx` (`common:seo.title`). Une valeur dans ce layout aurait été servie
    // aux quatre langues — `<title>`, meta description et `og:title` étaient en français sur /en,
    // /nl et /de. « KREDIT » (marque, sans espace) est la seule constante admise par la garde
    // `untranslated-metadata`.
    template: "%s | KREDIT",
  },
  applicationName: "KREDIT",
  keywords: ["KREDIT", "BE", "EUR", "TAEG", "fintech"],
  authors: [{ name: "KREDIT" }],
  creator: "KREDIT",
  publisher: "KREDIT",
  icons: {
    icon: [
      { url: "/icons/icon-72.png", sizes: "72x72" },
      { url: "/icons/icon-192.png", sizes: "192x192" },
      { url: "/icons/icon-512.png", sizes: "512x512" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
    shortcut: "/icons/icon-192.png",
  },
  formatDetection: { telephone: false },
  category: "finance",
};

export const viewport = {
  themeColor: "#0F1115",
  colorScheme: "dark light",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // lang est un point de départ (fr): le layout racine ne reçoit pas les params du
    // segment [locale], donc HtmlLang (layout enfant) applique la vraie langue après hydratation.
    // suppressHydrationWarning est légitime ICI uniquement (attribut muté hors React —
    // voir docs/hydration.md, règle 5).
    <html lang="fr" suppressHydrationWarning>
      <head>
        {/* Échappatoire n°2 — repli sans JavaScript: `[data-reveal]` garde le contenu à
            `opacity: 0` jusqu'à ce qu'un observateur le libère. Sans JS, personne ne le libère —
            cette règle est donc la seule qui rend la page lisible à un crawler sans moteur, à un
            bloqueur de scripts, et à l'impression. Elle vit dans le <head>, où <style> est permis
            et hors du corps que React réconcilie. */}
        <noscript>
          <style>{`[data-reveal]{opacity:1!important;transform:none!important;filter:none!important}`}</style>
        </noscript>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className="bg-white text-ink antialiased font-body">
        {/* Pas de skip-link ici: son libellé est de la copie à traduire, et ce layout ne connaît
            pas le segment [locale] (params === {} en Next 14). Il vit dans
            `app/[locale]/layout.tsx` (`common:shell.skipToContent`). */}
        {children}
      </body>
    </html>
  );
}
