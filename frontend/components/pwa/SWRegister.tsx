"use client";
/**
 * Enregistrement du service worker + UI hors-ligne / mise à jour / installation.
 *
 * - En DEV : on n'enregistre RIEN, et on purge les installations héritées (unregister + caches
 *   kredit-*) — un worker en dev mettrait en cache des chunks non hachés réécrits à chaque
 *   compile (verrou check-hydration « sw-registered-in-dev », qui exige le garde NODE_ENV et
 *   l'unregister ici même).
 * - En PROD : enregistrement après `load`, détection d'une version en attente (toast
 *   « mise à jour disponible » → SKIP_WAITING), bannière hors-ligne et prompt d'installation.
 * - Aucune API navigateur au render : tout état démarre neutre et bouge dans les effects
 *   (contrat d'hydratation) ; la copie vient des clés `pwa.*`.
 */
import { useEffect, useState } from "react";
import { RefreshCw, WifiOff, Download, X } from "lucide-react";
import { Locale, t } from "@/lib/i18n";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function SWRegister({ locale }: { locale: Locale }) {
  const tr = (k: string, vars?: Record<string, string | number>) => t(locale, k, vars);
  const [enLigne, setEnLigne] = useState<boolean | null>(null);
  const [banniere, setBanniere] = useState(true);
  const [maj, setMaj] = useState(false);
  const [install, setInstall] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      // Dev : désenregistrer les workers hérités et purger leurs caches.
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((r) => r.unregister());
      });
      if ("caches" in window) {
        caches.keys().then((cles) => {
          cles.filter((c) => c.startsWith("kredit-")).forEach((c) => caches.delete(c));
        });
      }
      return;
    }

    const surChargement = () => {
      navigator.serviceWorker.register("/sw.js").then((reg) => {
        const basculer = () => {
          const attendant = reg.waiting;
          if (attendant && navigator.serviceWorker.controller) setMaj(true);
        };
        basculer();
        reg.addEventListener("updatefound", () => {
          const neuf = reg.installing;
          if (!neuf) return;
          neuf.addEventListener("statechange", () => {
            if (neuf.state === "installed" && navigator.serviceWorker.controller) setMaj(true);
          });
        });
      });
    };
    window.addEventListener("load", surChargement);

    const surHorsLigne = () => { setEnLigne(false); setBanniere(true); };
    const surEnLigne = () => setEnLigne(true);
    window.addEventListener("offline", surHorsLigne);
    window.addEventListener("online", surEnLigne);

    const surPrompt = (e: Event) => { e.preventDefault(); setInstall(e as BeforeInstallPromptEvent); };
    const surInstalle = () => setInstall(null);
    window.addEventListener("beforeinstallprompt", surPrompt);
    window.addEventListener("appinstalled", surInstalle);

    return () => {
      window.removeEventListener("load", surChargement);
      window.removeEventListener("offline", surHorsLigne);
      window.removeEventListener("online", surEnLigne);
      window.removeEventListener("beforeinstallprompt", surPrompt);
      window.removeEventListener("appinstalled", surInstalle);
    };
  }, []);

  const appliquerMaj = () => {
    navigator.serviceWorker.getRegistration().then((reg) => {
      reg?.waiting?.postMessage("SKIP_WAITING");
      window.location.reload();
    });
  };

  return (
    <>
      {maj && (
        <div role="status" className="fixed bottom-4 inset-x-4 md:inset-x-auto md:right-6 md:max-w-sm z-[90] bg-ink text-white rounded-2xl shadow-card border border-white/15 p-4">
          <div className="flex items-center gap-3">
            <RefreshCw className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
            <p className="text-[13px] leading-5 text-white/85">{tr("pwa.updateAvailable")}</p>
          </div>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={appliquerMaj} className="h-9 px-4 rounded-full bg-primary text-white text-[12px] font-extrabold uppercase tracking-wide hover:bg-primary-hover transition">
              {tr("pwa.updateApply")}
            </button>
            <button type="button" onClick={() => setMaj(false)} className="h-9 px-4 rounded-full bg-white/10 text-white/80 text-[12px] font-bold uppercase tracking-wide hover:bg-white/15 transition">
              {tr("pwa.updateDismiss")}
            </button>
          </div>
        </div>
      )}

      {!maj && enLigne === false && banniere && (
        <div role="status" className="fixed bottom-4 inset-x-4 md:inset-x-auto md:right-6 md:max-w-sm z-[90] bg-amber-500 text-ink rounded-2xl shadow-card p-4">
          <div className="flex items-start gap-3">
            <WifiOff className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <p className="text-[13px] font-extrabold">{tr("pwa.offlineBanner")}</p>
              <p className="text-[12px] leading-5 mt-0.5">{tr("pwa.offlineBannerData")}</p>
            </div>
            <button type="button" onClick={() => setBanniere(false)} aria-label={tr("pwa.close")} className="ml-auto w-7 h-7 grid place-items-center rounded-full hover:bg-ink/10 transition">
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {!maj && enLigne !== false && install && (
        <div role="dialog" aria-label={tr("pwa.installAria")} className="fixed bottom-4 inset-x-4 md:inset-x-auto md:right-6 md:max-w-sm z-[90] bg-white text-ink rounded-2xl shadow-card border p-4">
          <div className="flex items-start gap-3">
            <span className="w-9 h-9 rounded-xl bg-primary-light text-primary grid place-items-center shrink-0"><Download className="w-4 h-4" aria-hidden="true" /></span>
            <div>
              <p className="text-[13px] font-extrabold">{tr("pwa.install")}</p>
              <p className="text-[12px] leading-5 text-slate-500 mt-0.5">{tr("pwa.installBody")}</p>
              <p className="text-[11px] text-slate-400 mt-1">{tr("pwa.installNote")}</p>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => { install.prompt(); setInstall(null); }}
              className="h-9 px-4 rounded-full bg-primary text-white text-[12px] font-extrabold uppercase tracking-wide hover:bg-primary-hover transition"
            >
              {tr("pwa.installBtn")}
            </button>
            <button type="button" onClick={() => setInstall(null)} className="h-9 px-4 rounded-full bg-slate-100 text-slate-600 text-[12px] font-bold uppercase tracking-wide hover:bg-slate-200 transition">
              {tr("pwa.installLater")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
