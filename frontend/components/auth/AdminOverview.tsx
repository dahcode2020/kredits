"use client";
/**
 * Slice 22 — « l'œil de l'administrateur » : l'Aperçu exhaustif de la plateforme.
 *
 * Réservé ADMIN / SUPER_ADMIN. Tout vient de GET /api/activite (le serveur agrège comptes,
 * KYC, transactions, virements et chat borné à une semaine). Le client n'y a jamais accès.
 * Rafraîchissement automatique léger pour coller au « temps réel », plus un bouton manuel.
 */
import { useCallback, useEffect, useState } from "react";
import {
  ArrowDownLeft, ArrowLeftRight, ArrowUpRight, BadgeCheck, Fingerprint, MessageCircle,
  RefreshCw, Users, Wallet,
} from "lucide-react";
import { buttonClasses } from "@/components/ui/Button";
import { formatEUR2, cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/formatters";
import { Locale, t, tSiCle } from "@/lib/i18n";
import { API, apiGet } from "@/lib/api";

interface Evenement {
  ts: string; type: "credit" | "debit" | "chat" | "kyc" | "virement";
  email: string; nom: string; montant?: number; detail?: string;
}
interface Activite {
  totaux: {
    clients: number; kycVerifies: number; kycEnAttente: number;
    transactions: number; volumeEntrant: number; volumeSortant: number; soldeCumule: number;
    virementsActifs: number; messagesChat: number;
  };
  recent: Evenement[];
  docsEnAttente: number; chargesEnAttente: number;
}

const INTERVALLE_MS = 15000;

export default function AdminOverview({ locale }: { locale: Locale }) {
  const tr = (k: string, vars?: Record<string, string | number>) => t(locale, k, vars);
  const [donnees, setDonnees] = useState<Activite | null>(null);
  const [apiKo, setApiKo] = useState(false);
  const [maj, setMaj] = useState<string | null>(null);

  const charger = useCallback(() => {
    apiGet<Activite>(API.activite).then((r) => {
      if (!r.ok) { setApiKo(true); return; }
      setApiKo(false);
      setDonnees(r.corps);
      setMaj(new Date().toISOString());
    });
  }, []);

  useEffect(() => {
    charger();
    const sonde = window.setInterval(charger, INTERVALLE_MS);
    return () => window.clearInterval(sonde);
  }, [charger]);

  if (apiKo || !donnees) {
    return (
      <div className="bg-white rounded-[24px] shadow-card border p-8 text-center">
        <p className="text-sm font-bold text-ink">{tr("banque:apiDown")}</p>
      </div>
    );
  }

  const T = donnees.totaux;
  const cartes: Array<{ cle: string; valeur: string; Ic: typeof Users; teinte: string }> = [
    { cle: "dashboard.admin.stats.clients", valeur: String(T.clients), Ic: Users, teinte: "text-primary" },
    { cle: "dashboard.admin.stats.kycOk", valeur: String(T.kycVerifies), Ic: BadgeCheck, teinte: "text-emerald-600" },
    { cle: "dashboard.admin.stats.kycPending", valeur: String(T.kycEnAttente), Ic: Fingerprint, teinte: "text-amber-600" },
    { cle: "dashboard.admin.stats.tx", valeur: String(T.transactions), Ic: ArrowLeftRight, teinte: "text-primary" },
    { cle: "dashboard.admin.stats.txIn", valeur: formatEUR2(T.volumeEntrant, locale), Ic: ArrowDownLeft, teinte: "text-emerald-600" },
    { cle: "dashboard.admin.stats.txOut", valeur: formatEUR2(T.volumeSortant, locale), Ic: ArrowUpRight, teinte: "text-red-500" },
    { cle: "dashboard.admin.stats.solde", valeur: formatEUR2(T.soldeCumule, locale), Ic: Wallet, teinte: "text-primary" },
    { cle: "dashboard.admin.stats.virements", valeur: String(T.virementsActifs), Ic: ArrowLeftRight, teinte: "text-amber-600" },
    { cle: "dashboard.admin.stats.chat", valeur: String(T.messagesChat), Ic: MessageCircle, teinte: "text-primary" },
  ];

  const iconeEvt = (type: Evenement["type"]) => {
    switch (type) {
      case "credit": return <ArrowDownLeft className="w-4 h-4 text-emerald-600" aria-hidden="true" />;
      case "debit": return <ArrowUpRight className="w-4 h-4 text-red-500" aria-hidden="true" />;
      case "virement": return <ArrowLeftRight className="w-4 h-4 text-primary" aria-hidden="true" />;
      case "chat": return <MessageCircle className="w-4 h-4 text-primary" aria-hidden="true" />;
      default: return <Fingerprint className="w-4 h-4 text-amber-600" aria-hidden="true" />;
    }
  };
  /** Texte d'une ligne du fil : clé i18n par type, variables résolues. */
  const texteEvt = (e: Evenement): string => {
    const montant = e.montant !== undefined ? formatEUR2(e.montant, locale) : "";
    const tiers = e.detail ?? "";
    if (e.type === "chat") return tr("dashboard.admin.evt.chat", { detail: tSiCle(locale, e.detail ?? "") });
    if (e.type === "kyc") return tr(e.detail === "verifie" ? "dashboard.admin.evt.kyc.verifie" : "dashboard.admin.evt.kyc.attente");
    const cle = e.type === "credit" ? "dashboard.admin.evt.credit" : e.type === "debit" ? "dashboard.admin.evt.debit" : "dashboard.admin.evt.virement";
    return tr(cle, { montant, tiers });
  };

  return (
    <div className="space-y-6">
      {/* En-tête : titre + rafraîchissement manuel. */}
      <div className="bg-white rounded-[24px] shadow-card border p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display font-extrabold text-ink text-lg">{tr("dashboard.admin.title")}</h3>
            <p className="mt-1 text-[13px] text-slate-500">{tr("dashboard.admin.subtitle")}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-slate-400">{tr("dashboard.admin.live")}</span>
            <button type="button" onClick={charger} className={buttonClasses("outline-light", "sm")}>
              <RefreshCw className="w-4 h-4" aria-hidden="true" />
              <span className="ml-2">{tr("dashboard.admin.refresh")}</span>
            </button>
          </div>
        </div>
        {maj && <p className="mt-2 text-[11px] text-slate-400 tabular-nums">{formatDateTime(maj, locale)}</p>}
      </div>

      {/* Le total des transactions effectuées, mis en avant. */}
      <div className="rounded-[24px] overflow-hidden bg-ink text-white p-6 md:p-8 shadow-card relative">
        <div className="maillage opacity-50" aria-hidden="true" />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="text-[12px] tracking-[0.18em] font-bold uppercase text-primary">{tr("dashboard.admin.stats.tx")}</div>
            <div className="mt-1 font-display font-extrabold text-[44px] leading-none tabular-nums">{T.transactions}</div>
            <div className="mt-2 text-[13px] text-white/60">{tr("dashboard.admin.subtitle")}</div>
          </div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-[13px]">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-white/50">{tr("dashboard.admin.stats.txIn")}</div>
              <div className="mt-0.5 font-extrabold tabular-nums text-emerald-300">{formatEUR2(T.volumeEntrant, locale)}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-white/50">{tr("dashboard.admin.stats.txOut")}</div>
              <div className="mt-0.5 font-extrabold tabular-nums text-red-300">{formatEUR2(T.volumeSortant, locale)}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-white/50">{tr("dashboard.admin.stats.solde")}</div>
              <div className="mt-0.5 font-extrabold tabular-nums">{formatEUR2(T.soldeCumule, locale)}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-white/50">{tr("dashboard.admin.stats.virements")}</div>
              <div className="mt-0.5 font-extrabold tabular-nums">{T.virementsActifs}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Grille des compteurs. */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cartes.map((c) => (
          <div key={c.cle} className="bg-white rounded-[20px] border shadow-soft p-5 flex items-center gap-4">
            <span className={cn("w-11 h-11 rounded-2xl bg-surface grid place-items-center", c.teinte)}><c.Ic className="w-5 h-5" aria-hidden="true" /></span>
            <div>
              <div className="text-[11px] font-bold tracking-widest uppercase text-slate-500">{tr(c.cle)}</div>
              <div className="mt-0.5 font-display font-extrabold text-ink text-[24px] tabular-nums">{c.valeur}</div>
            </div>
          </div>
        ))}
      </div>

      {/* À traiter : pièces à approuver + charges en attente. */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="bg-white rounded-[20px] border shadow-soft p-5">
          <div className="text-[11px] font-bold tracking-widest uppercase text-slate-500">{tr("dashboard.admin.stats.docs")}</div>
          <div className="mt-1 font-display font-extrabold text-ink text-[24px] tabular-nums">{donnees.docsEnAttente}</div>
        </div>
        <div className="bg-white rounded-[20px] border shadow-soft p-5">
          <div className="text-[11px] font-bold tracking-widest uppercase text-slate-500">{tr("dashboard.admin.stats.charges")}</div>
          <div className="mt-1 font-display font-extrabold text-ink text-[24px] tabular-nums">{donnees.chargesEnAttente}</div>
        </div>
      </div>

      {/* Fil d'activité récent. */}
      <div className="bg-white rounded-[24px] shadow-card border p-6">
        <h4 className="font-display font-extrabold text-ink flex items-center gap-2">
          <ArrowLeftRight className="w-5 h-5 text-primary" aria-hidden="true" /> {tr("dashboard.admin.activity")}
        </h4>
        {donnees.recent.length === 0 ? (
          <p className="mt-3 text-[13px] text-slate-500">{tr("dashboard.admin.activity.empty")}</p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100">
            {donnees.recent.map((e, i) => (
              <li key={`${e.ts}-${i}`} className="py-3 flex items-center gap-3">
                <span className="w-8 h-8 rounded-xl bg-surface grid place-items-center shrink-0">{iconeEvt(e.type)}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-ink truncate">{texteEvt(e)}</div>
                  <div className="text-[11px] text-slate-400 truncate">{e.nom} · {e.email}</div>
                </div>
                <span className="text-[11px] text-slate-400 tabular-nums shrink-0">{formatDateTime(e.ts, locale)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
