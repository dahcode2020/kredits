"use client";
/**
 * Slice 9 — écran SUPER_ADMIN de l'historique des grilles.
 *
 * Tout vient de LA table partagée (rate_be/grille.json) via les exports du moteur — aucune copie :
 * chaque version affiche ses paliers, ses produits, ses règles `rate_BE_…` dérivées par la MÊME
 * fonction que le simulateur (reglesDeEntree), son hash et son chaînon. Le recalcul complet de la
 * chaîne de hashes est verrouillé par tests et par la garde check:regles ; ici on affiche les
 * sceaux et la validité du chaînage (comparaison de pointeurs, pure).
 *
 * Pur au render : rien de navigateur — le bouton « copier » n'agit que dans son handler, la sonde
 * d'audit daté part d'un état vide.
 */
import { useEffect, useState } from "react";
import { BadgeCheck, Copy, Check, History, Link2, Server, ServerOff, ShieldCheck, Table2 } from "lucide-react";
import { buttonClasses } from "@/components/ui/Button";
import { cn, formatEUR2 } from "@/lib/utils";
import { formatPercent, formatCurrency0 } from "@/lib/formatters";
import { formatDate } from "@/lib/formatters";
import { Locale, t } from "@/lib/i18n";
import { API, apiGet } from "@/lib/api";
import {
  GRILLE, GRILLE_VERSION, HISTORIQUE_GRILLES, chainonValide, grilleValideA, reglesDeEntree,
  type EntreeGrille,
} from "@/lib/credit-engine";

function hashCourt(h: string): string {
  return `${h.slice(0, 12)}…${h.slice(-6)}`;
}

function CarteEntree({ entree, precedente, locale, tr }: {
  entree: EntreeGrille; precedente: EntreeGrille | null; locale: Locale;
  tr: (k: string, vars?: Record<string, string | number>) => string;
}) {
  const [reglesVisibles, setReglesVisibles] = useState(false);
  const [copie, setCopie] = useState<"hash" | "prev" | null>(null);
  const ouverte = entree.effectif_au === null;
  const chainon = chainonValide(entree, precedente);
  const regles = reglesDeEntree(entree, GRILLE.pays);

  const copier = (texte: string, quoi: "hash" | "prev") => {
    navigator.clipboard?.writeText(texte).catch(() => undefined);
    setCopie(quoi);
    window.setTimeout(() => setCopie(null), 1600);
  };

  return (
    <article className={cn("bg-white rounded-[24px] shadow-card border p-6", ouverte && "ring-2 ring-primary/30")}>
      <header className="flex flex-wrap items-center gap-3">
        <div className="w-10 h-10 rounded-2xl bg-ink text-white grid place-items-center shrink-0">
          <History className="w-5 h-5" aria-hidden="true" />
        </div>
        <div>
          <h3 className="font-display font-extrabold text-ink leading-tight">{entree.version}</h3>
          <div className="text-[12px] text-slate-400">
            {ouverte ? tr("admin.grille.since", { du: formatDate(entree.effectif_du, locale) }) : tr("admin.grille.closed", { du: formatDate(entree.effectif_du, locale), au: formatDate(entree.effectif_au as string, locale) })}
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {ouverte && (
            <span className="inline-flex items-center gap-1 text-[11px] font-extrabold uppercase tracking-wider px-3 py-1.5 rounded-full bg-primary-light text-primary">
              {tr("admin.grille.current")} · {tr("admin.grille.open")}
            </span>
          )}
          <span className={cn("inline-flex items-center gap-1 text-[11px] font-extrabold uppercase tracking-wider px-3 py-1.5 rounded-full", chainon ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600")}>
            <Link2 className="w-3.5 h-3.5" aria-hidden="true" /> {tr("admin.grille.chainOk")}
          </span>
        </div>
      </header>

      {entree.note && <p className="mt-3 text-[13px] leading-6 text-slate-500"><strong className="text-slate-400 text-[11px] uppercase tracking-widest">{tr("admin.grille.note")}</strong><br />{entree.note}</p>}

      {/* ——— Sceaux ——— */}
      <dl className="mt-4 grid md:grid-cols-2 gap-3">
        {([["admin.grille.hash", entree.hash, "hash"], ["admin.grille.prevHash", entree.hash_precedent, "prev"]] as Array<[string, string | null, "hash" | "prev"]>).map(([cle, valeur, quoi]) => (
          <div key={cle} className="rounded-2xl bg-surface border p-3">
            <dt className="text-[10px] font-bold tracking-widest uppercase text-slate-400">{tr(cle)}</dt>
            <dd className="mt-1 flex items-center gap-2">
              {valeur ? (
                <>
                  <code className="font-mono text-[12px] text-ink break-all">{hashCourt(valeur)}</code>
                  <button type="button" onClick={() => copier(valeur, quoi)} aria-label={tr("admin.grille.copy")} className="w-7 h-7 grid place-items-center rounded-full hover:bg-white transition shrink-0">
                    {copie === quoi ? <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />}
                  </button>
                </>
              ) : (
                <span className="text-[12px] text-slate-400 italic">{tr("admin.grille.genesis")}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>

      {/* ——— Paliers ——— */}
      <h4 className="mt-5 text-[11px] font-extrabold tracking-widest uppercase text-primary flex items-center gap-2"><Table2 className="w-4 h-4" aria-hidden="true" /> {tr("admin.grille.paliers")}</h4>
      <ul className="mt-2 divide-y divide-slate-100 rounded-2xl border overflow-hidden">
        {entree.paliers_taux.map((p) => (
          <li key={p.min} className="flex items-center justify-between px-4 py-2.5 text-[13px] bg-white">
            <span className="text-slate-600 tabular-nums">
              {p.max === null
                ? tr("admin.grille.andAbove", { min: formatCurrency0(p.min - 1, locale) })
                : `${formatCurrency0(p.min, locale)} ${tr("admin.grille.upTo", { max: formatCurrency0(p.max, locale) })}`}
            </span>
            <strong className="text-ink tabular-nums">{formatPercent(p.taux, locale, 2)}</strong>
          </li>
        ))}
      </ul>

      {/* ——— Produits ——— */}
      <h4 className="mt-5 text-[11px] font-extrabold tracking-widest uppercase text-primary">{tr("admin.grille.products")}</h4>
      <div className="mt-2 overflow-x-auto rounded-2xl border">
        <table className="w-full text-[12px] min-w-[560px]">
          <thead>
            <tr className="bg-surface text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">
              <th className="px-3 py-2">{tr("admin.grille.products")}</th>
              <th className="px-3 py-2 text-right">{tr("admin.grille.min")}</th>
              <th className="px-3 py-2 text-right">{tr("admin.grille.max")}</th>
              <th className="px-3 py-2 text-right">{tr("admin.grille.termMin")}</th>
              <th className="px-3 py-2 text-right">{tr("admin.grille.termMax")}</th>
              <th className="px-3 py-2 text-right">{tr("admin.grille.step")}</th>
              <th className="px-3 py-2 text-right">{tr("admin.grille.fees")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {Object.entries(entree.produits).map(([code, p]) => (
              <tr key={code} className="bg-white">
                <td className="px-3 py-2 font-extrabold text-ink">{tr(`credit:simulator.tab.${code}`)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCurrency0(p.min, locale)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCurrency0(p.max, locale)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{tr("admin.grille.months", { n: p.minTerm })}</td>
                <td className="px-3 py-2 text-right tabular-nums">{tr("admin.grille.months", { n: p.maxTerm })}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCurrency0(p.pas, locale)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatPercent(p.frais.filePct, locale, 2)} · {formatCurrency0(p.frais.fileMin, locale)}–{formatCurrency0(p.frais.fileMax, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ——— Règles dérivées ——— */}
      <button
        type="button"
        onClick={() => setReglesVisibles((v) => !v)}
        aria-expanded={reglesVisibles}
        className={buttonClasses("outline-light", "sm", "mt-4")}
      >
        {tr("admin.grille.rules", { count: regles.length })} {reglesVisibles ? "−" : "+"}
      </button>
      {reglesVisibles && (
        <ul className="mt-3 divide-y divide-slate-100 rounded-2xl border overflow-hidden">
          {regles.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 bg-white text-[12px]">
              <code className="font-mono font-bold text-ink">{r.id}</code>
              <span className="text-slate-400 tabular-nums">
                {formatCurrency0(r.minAmount, locale)}–{formatCurrency0(r.maxAmount, locale)} · {tr("admin.grille.months", { n: r.minTerm })}–{tr("admin.grille.months", { n: r.maxTerm })}
              </span>
              <strong className="ml-auto text-primary tabular-nums">{formatPercent(r.baseRate, locale, 2)}</strong>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

interface GrilleApi {
  version: string; regles_effectives: unknown[];
  historique: Array<{ chainon_valide: boolean }>;
}

export default function GrilleHistorique({ locale }: { locale: Locale }) {
  const tr = (k: string, vars?: Record<string, string | number>) => t(locale, k, vars);
  const [dateSonde, setDateSonde] = useState("");
  const [sonde, setSonde] = useState<EntreeGrille | null>(null);
  const [api, setApi] = useState<"ok" | "down" | "entente" | null>(null);
  const [apiDetail, setApiDetail] = useState<{ version: string; regles: number } | null>(null);

  useEffect(() => {
    let actif = true;
    apiGet<GrilleApi>(API.grille).then((reponse) => {
      if (!actif) return;
      if (!reponse.ok || !reponse.corps.version) { setApi("down"); return; }
      const corps = reponse.corps;
      const chaineOk = corps.historique.every((h) => h.chainon_valide);
      const accord = corps.version === GRILLE_VERSION && chaineOk;
      setApiDetail({ version: corps.version, regles: corps.regles_effectives.length });
      setApi(accord ? "ok" : "entente");
    });
    return () => { actif = false; };
  }, []);

  const entrees = [...HISTORIQUE_GRILLES].reverse();

  return (
    <div className="space-y-6">
      <div className="bg-ink text-white rounded-[24px] p-6 md:p-8 shadow-card">
        <h2 className="font-display font-extrabold text-2xl flex items-center gap-3">
          <ShieldCheck className="w-6 h-6 text-primary" aria-hidden="true" /> {tr("admin.grille.title")}
        </h2>
        <p className="mt-2 text-sm leading-6 text-white/60">{tr("admin.grille.subtitle", { table: "rate_be/grille.json" })}</p>
        <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-[12px]">
          {([["admin.grille.schema", GRILLE.schema], ["admin.grille.country", GRILLE.pays], ["admin.grille.currency", GRILLE.devise]] as Array<[string, string]>).map(([cle, valeur]) => (
            <div key={cle}>
              <dt className="text-[10px] font-bold tracking-widest uppercase text-white/40">{tr(cle)}</dt>
              <dd className="font-mono font-bold">{valeur}</dd>
            </div>
          ))}
        </dl>
        {api && (
          <p
            role="status"
            className={cn(
              "mt-4 inline-flex items-center gap-2 rounded-full px-4 py-2 text-[12px] font-extrabold uppercase tracking-wider",
              api === "ok" ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300",
            )}
          >
            {api === "ok" ? <Server className="w-4 h-4" aria-hidden="true" /> : <ServerOff className="w-4 h-4" aria-hidden="true" />}
            {api === "ok" && apiDetail
              ? tr("admin.grille.apiOk", { version: apiDetail.version, regles: apiDetail.regles })
              : tr(api === "down" ? "admin.grille.apiDown" : "admin.grille.apiMismatch")}
          </p>
        )}

        {/* ——— Sonde d'audit daté ——— */}
        <div className="mt-5 rounded-2xl bg-white/5 border border-white/10 p-4">
          <div className="text-[11px] font-bold tracking-widest uppercase text-white/50">{tr("admin.grille.probe")}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="text-[11px] font-bold uppercase tracking-wider text-white/50" htmlFor="sonde-date">{tr("admin.grille.probeDate")}</label>
            <input
              id="sonde-date" type="date" value={dateSonde} onChange={(e) => { setDateSonde(e.target.value); setSonde(null); }}
              className="h-10 rounded-xl bg-white border border-white/15 px-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <button
              type="button" disabled={!dateSonde} onClick={() => setSonde(grilleValideA(`${dateSonde}T12:00:00Z`))}
              className={buttonClasses("primary", "sm", !dateSonde ? "opacity-50 pointer-events-none" : "")}
            >
              {tr("admin.grille.probeApply")}
            </button>
          </div>
          {sonde && (
            <p role="status" className="mt-3 text-[13px] font-bold text-emerald-400 flex items-center gap-2">
              <BadgeCheck className="w-4 h-4" aria-hidden="true" /> {tr("admin.grille.probeResult", { version: sonde.version })}
            </p>
          )}
        </div>
      </div>

      {/* ——— Versions, la plus récente d'abord ——— */}
      <div className="space-y-6">
        {entrees.map((entree, i) => (
          <CarteEntree key={entree.version} entree={entree} precedente={i + 1 < entrees.length ? entrees[i + 1] : null} locale={locale} tr={tr} />
        ))}
      </div>
    </div>
  );
}
