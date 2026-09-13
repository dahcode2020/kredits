import { Locale, locales, t } from "@/lib/i18n";
import { SITE_ORIGIN, SITE_NAME } from "@/lib/seo";
import { notFound } from "next/navigation";
import { WifiOff } from "lucide-react";
import Link from "next/link";
import { buttonClasses } from "@/components/ui/Button";

/**
 * Page de secours hors-ligne — précachée par le service worker (la seule page HTML en cache,
 * avec l'accord explicite de la garde « sw-cached-document »). Copie des clés `pwa.*`,
 * aucun lien vers une route qui exigerait le réseau : accueil seulement.
 */
export function generateMetadata({ params }: { params: { locale: string } }) {
  const locale = (locales as readonly string[]).includes(params.locale) ? (params.locale as Locale) : "fr";
  const titre = `${t(locale, "pwa.offlinePageTitle")} | ${SITE_NAME}`;
  return {
    metadataBase: new URL(SITE_ORIGIN),
    title: { absolute: titre },
    description: t(locale, "pwa.offlinePageSub"),
    robots: { index: false, follow: false },
  };
}

export default function OfflinePage({ params }: { params: { locale: string } }) {
  if (!(locales as readonly string[]).includes(params.locale)) notFound();
  const locale = params.locale as Locale;
  const tr = (k: string) => t(locale, k);
  return (
    <div className="bg-surface min-h-[70vh] grid place-items-center px-6 py-16">
      <div className="max-w-xl w-full bg-white rounded-[24px] shadow-card border p-8 md:p-10 text-center">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-100 text-amber-600 grid place-items-center">
          <WifiOff className="w-7 h-7" aria-hidden="true" />
        </div>
        <h1 className="mt-4 font-display font-extrabold text-ink text-[28px] tracking-tight">{tr("pwa.offlinePageTitle")}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">{tr("pwa.offlinePageSub")}</p>
        <div className="mt-6 grid md:grid-cols-2 gap-4 text-left">
          <div className="rounded-2xl bg-surface border p-4">
            <div className="text-[11px] font-bold tracking-widest uppercase text-emerald-600">{tr("pwa.offlineAvailable")}</div>
            <ul className="mt-2 space-y-1 text-[13px] text-slate-600">
              <li>— {tr("pwa.offlineAvail1")}</li>
              <li>— {tr("pwa.offlineAvail2")}</li>
              <li>— {tr("pwa.offlineAvail3")}</li>
            </ul>
          </div>
          <div className="rounded-2xl bg-surface border p-4">
            <div className="text-[11px] font-bold tracking-widest uppercase text-red-500">{tr("pwa.offlineRequires")}</div>
            <ul className="mt-2 space-y-1 text-[13px] text-slate-600">
              <li>— {tr("pwa.offlineUnavail1")}</li>
              <li>— {tr("pwa.offlineUnavail2")}</li>
              <li>— {tr("pwa.offlineUnavail3")}</li>
              <li>— {tr("pwa.offlineUnavail4")}</li>
            </ul>
          </div>
        </div>
        <p className="mt-5 text-[11px] text-slate-400">{tr("pwa.offlineSecurityNote")}</p>
        <Link href={`/${locale}`} className={buttonClasses("primary", "md", "mt-6")}>{tr("pwa.offlineHome")}</Link>
      </div>
    </div>
  );
}
