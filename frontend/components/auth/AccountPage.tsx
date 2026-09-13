"use client";
/**
 * « use client » : la session locale n'est lue qu'après montage (jamais au render) ; le premier
 * rendu client est identique au HTML serveur (portail verrouillé), puis l'effet révèle l'espace
 * connecté — pas de mismatch d'hydratation, et sans JavaScript le portail renvoie vers
 * l'authentification au lieu de prétendre être connecté.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, LogOut, UserRound } from "lucide-react";
import Reveal from "@/components/motion/Reveal";
import { buttonClasses } from "@/components/ui/Button";
import { formatDate } from "@/lib/formatters";
import { Locale, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { fermerSession, lireSession, type Role, type Session } from "@/lib/auth";
import { lireDemandes } from "@/lib/application";

const CLES_ROLE: Record<Role, string> = {
  CUSTOMER: "auth.role.customer",
  ADMIN: "auth.role.admin",
  SUPER_ADMIN: "auth.role.super",
};

export default function AccountPage({ locale }: { locale: Locale }) {
  const tr = (k: string, vars?: Record<string, string | number>) => t(locale, k, vars);
  const [session, setSession] = useState<Session | null>(null);
  const [pret, setPret] = useState(false);
  const [demandes, setDemandes] = useState<ReturnType<typeof lireDemandes>>([]);

  useEffect(() => {
    const s = lireSession();
    setSession(s);
    if (s) setDemandes(lireDemandes().filter((d) => d.email.toLowerCase() === s.email.toLowerCase()));
    setPret(true);
  }, []);

  const deconnexion = () => {
    fermerSession();
    setSession(null);
    setDemandes([]);
  };

  return (
    <div className="bg-surface">
      <section className="relative overflow-hidden bg-ink">
        <div className="maillage" aria-hidden="true" />
        <div className="relative mx-auto max-w-[1280px] px-6 py-12 md:py-16">
          <Reveal as="h1" variant="fade" className="font-display font-extrabold text-white text-[36px] md:text-[46px] leading-[1.02] tracking-tight">
            {session ? tr("account.hello", { name: session.nom }) : tr("account.title")}
          </Reveal>
          {session && (
            <Reveal as="div" retard={100} className="mt-4 flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary text-white text-[11px] font-extrabold tracking-widest uppercase">
                <UserRound className="w-3.5 h-3.5" aria-hidden="true" /> {tr(CLES_ROLE[session.role])}
              </span>
              <span className="text-sm text-white/70 tabular-nums">{session.email}</span>
            </Reveal>
          )}
        </div>
      </section>

      <div className="mx-auto max-w-[1280px] px-6 py-10 md:py-14">
        {!pret || !session ? (
          /* Portail verrouillé — même HTML serveur et premier rendu client. */
          <Reveal as="div" variant="fade" className="bg-white rounded-[24px] shadow-card border p-8 md:p-12 text-center max-w-xl mx-auto">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-primary-light text-primary grid place-items-center">
              <UserRound className="w-7 h-7" aria-hidden="true" />
            </div>
            <h2 className="mt-4 font-extrabold text-ink text-xl">{tr("shell.gateTitle")}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">{tr("roles.demoNote")}</p>
            <Link href={`/${locale}/auth`} className={buttonClasses("primary", "lg", "mt-6")}>
              {tr("auth.loginCta")} <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </Link>
          </Reveal>
        ) : (
          <div className="grid lg:grid-cols-[1.2fr_1fr] gap-8 items-start">
            <Reveal as="div" variant="fade" className="bg-white rounded-[24px] shadow-card border p-6 md:p-8">
              <h2 className="font-extrabold text-ink text-lg">{tr("nav.applications")}</h2>
              {demandes.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">{tr("empty.noData")}</p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {demandes.map((d) => (
                    <li key={d.id} className="rounded-2xl border border-slate-100 bg-surface p-4 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="font-bold text-ink tabular-nums">{d.id}</div>
                        <div className="text-[12px] text-slate-500 tabular-nums">{formatDate(d.createdAt, locale)}</div>
                      </div>
                      <span className={cn("px-2.5 py-1 rounded-full text-[10px] font-extrabold tracking-widest uppercase border bg-emerald-50 text-emerald-700 border-emerald-200")}>
                        {tr("credit:status.SUBMITTED")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href={`/${locale}/credit/simulator`} className={buttonClasses("primary", "md", "gap-2")}>
                  {tr("auth.creditCta")} <ArrowRight className="w-4 h-4" aria-hidden="true" />
                </Link>
                <button type="button" onClick={deconnexion} className={buttonClasses("outline-light", "md", "gap-2")}>
                  <LogOut className="w-4 h-4" aria-hidden="true" /> {tr("shell.logout")}
                </button>
              </div>
            </Reveal>
            <Reveal as="div" variant="left" retard={120} className="bg-ink text-white rounded-[24px] p-6 md:p-8 relative overflow-hidden">
              <div className="maillage opacity-40" aria-hidden="true" />
              <div className="relative">
                <p className="text-[13px] leading-6 text-white/70">{tr("account.demoBanner")}</p>
                <p className="mt-3 text-[13px] leading-6 text-white/50">{tr("account.nextSlice")}</p>
              </div>
            </Reveal>
          </div>
        )}
      </div>
    </div>
  );
}
