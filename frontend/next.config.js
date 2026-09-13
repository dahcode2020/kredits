/** @type {import('next').NextConfig} */
const nextConfig = {
  // Le dev n'écrit PAS dans le même dossier que `next build`. Partager un `.next` entre les deux
  // est la manière la plus fiable de produire exactement la panne « runtime webpack figé »: le
  // build de production remplace les chunks que le serveur de dev a en mémoire, le HTML servi
  // référence alors des identifiants de modules que le runtime chargé ne connaît pas ->
  // « Cannot read properties of undefined (reading 'call') » dans `options.factory`, réplicable à
  // merci par un rechargement, avec un serveur pourtant tout vert et tous ses fichiers à 200.
  // Ici: `next dev` compile dans `.next-dev`, `next build`/`next start` dans `.next`.
  // (Un NODE_ENV=production forcé avec `next dev` retomberait sur `.next`: c'est le seul cas où
  // l'isolation saute.) Contrôlé par `npm run check:state`.
  distDir: process.env.NODE_ENV === "production" ? ".next" : ".next-dev",
  reactStrictMode: true,
  compress: true,
  poweredByHeader: false,
  generateEtags: true,
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
        ],
      },
      {
        source: "/icons/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      ...(process.env.NODE_ENV === "production"
        ? [
            {
              // En dev, ces URLs sont stables et réécrites à chaque compile: les déclarer
              // « immutable » autoriserait le cache à figer un runtime webpack périmé ->
              // « reading 'call' » au premier reload après un rebuild. Prod seulement.
              source: "/_next/static/:path*",
              headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
            },
          ]
        : []),
    ];
  },
};

module.exports = nextConfig;
