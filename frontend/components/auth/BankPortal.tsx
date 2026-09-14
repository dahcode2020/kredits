"use client";
/**
 * Banque du compte client — slice 8 (démo locale), slice 11 : **l'état vit côté serveur**.
 * Solde + disponible + réservé, IBAN fictif mais formellement valide, virements sortants avec
 * barre de progression par niveaux de validation, mouvements du compte, messagerie support.
 *
 * L'UI envoie des INTENTIONS au serveur (/api/banque) qui applique la machine à états et renvoie
 * le nouvel état : rien n'est calculé ni stocké dans le navigateur. Contrat d'hydratation : tout
 * est lu dans un effect ; si l'API est injoignable, l'écran le dit au lieu d'inventer un solde.
 */
import { useEffect, useRef, useState } from "react";
import {
  ArrowDownLeft, ArrowUpRight, BadgeCheck, Check, Copy, Landmark, Lock, MessageCircle, Send,
  ServerOff, ShieldAlert, UserRound,
} from "lucide-react";
import CountUp from "@/components/motion/CountUp";
import { buttonClasses } from "@/components/ui/Button";
import { formatEUR2, cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/formatters";
import { Locale, t, tSiCle } from "@/lib/i18n";
import type { Session } from "@/lib/auth";
import { API, apiGet, apiPost } from "@/lib/api";
import {
  disponibleDe, progressionDe, reserveDe, soldeDe,
  type BanqueCompte, type MessageChat, type Referentiel, type StatutVirement, type Virement,
} from "@/lib/banque";

const CLES_STATUT: Record<StatutVirement, string> = {
  EN_COURS: "banque:vir.EN_COURS", BLOQUE: "banque:vir.BLOQUE", EXECUTE: "banque:vir.EXECUTE",
  REFUSE: "banque:vir.REFUSE", ANNULE: "banque:vir.ANNULE",
};
const COULEUR_STATUT: Record<StatutVirement, string> = {
  EN_COURS: "bg-primary-light text-primary", BLOQUE: "bg-red-50 text-red-600",
  EXECUTE: "bg-emerald-50 text-emerald-600", REFUSE: "bg-slate-100 text-slate-500", ANNULE: "bg-slate-100 text-slate-500",
};
const CLES_PIPELINE: Record<string, string> = {
  RECEPTION: "banque:pipeline.RECEPTION", CONFORMITE: "banque:pipeline.CONFORMITE",
  CERTIFICATS: "banque:pipeline.CERTIFICATS", EXECUTION: "banque:pipeline.EXECUTION",
};
const CLES_DEFAUT: Record<string, string> = {
  CERT_ASSURANCE: "banque:defaut.CERT_ASSURANCE", JUSTIF_DOMICILE: "banque:defaut.JUSTIF_DOMICILE",
  ORIGINE_FONDS: "banque:defaut.ORIGINE_FONDS", CAPACITE_INSUFFISANTE: "banque:defaut.CAPACITE_INSUFFISANTE",
};

/** Barre de progression par niveaux : segments du référentiel, état bloqué en rouge. */
function BarrePipeline({ v, ref, tr }: { v: Virement; ref: Referentiel; tr: (k: string, vars?: Record<string, string | number>) => string }) {
  const pct = progressionDe(v, ref);
  const bloque = v.statut === "BLOQUE";
  const fini = v.statut === "EXECUTE";
  let precedent = 0;
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] font-bold text-slate-500">
        <span>{tr("banque:pipeline.title")}</span>
        <span className={cn("tabular-nums", bloque ? "text-red-600" : fini ? "text-emerald-600" : "text-primary")}>
          {tr("banque:vir.progress", { pct })}
        </span>
      </div>
      <div className="mt-2 flex h-2.5 gap-1" role="img" aria-label={tr("banque:vir.progress", { pct })}>
        {ref.pipeline.map((niveau) => {
          const largeur = niveau.pct - precedent;
          precedent = niveau.pct;
          const fait = pct >= niveau.pct;
          return (
            <div key={niveau.code} title={tr(CLES_PIPELINE[niveau.code] ?? "")} style={{ width: `${largeur}%` }} className="h-full rounded-full bg-slate-100 overflow-hidden">
              <div
                className={cn("h-full transition-all duration-500", bloque ? "bg-red-500" : "bg-primary", (fait || (bloque && pct > niveau.pct - largeur)) && !fini && pct === niveau.pct && "motion-safe:animate-pulse")}
                style={{ width: fait ? "100%" : pct > niveau.pct - largeur ? `${((pct - (niveau.pct - largeur)) / largeur) * 100}%` : "0%" }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
        {ref.pipeline.map((niveau) => (
          <span key={niveau.code} className={cn("text-[10px] font-bold uppercase tracking-wider", pct >= niveau.pct ? (bloque ? "text-red-500" : "text-primary") : "text-slate-400")}>
            {tr(CLES_PIPELINE[niveau.code] ?? "")} · {niveau.pct} %
          </span>
        ))}
      </div>
    </div>
  );
}

export default function BankPortal({ locale, session }: { locale: Locale; session: Session }) {
  const tr = (k: string, vars?: Record<string, string | number>) => t(locale, k, vars);
  const [banque, setBanque] = useState<BanqueCompte | null>(null);
  const [messages, setMessages] = useState<MessageChat[]>([]);
  const [copie, setCopie] = useState(false);
  const [nomBenef, setNomBenef] = useState("");
  const [ibanBenef, setIbanBenef] = useState("");
  const [montant, setMontant] = useState("");
  const [motif, setMotif] = useState("");
  const [erreurEnvoi, setErreurEnvoi] = useState<string | null>(null);
  const [okEnvoi, setOkEnvoi] = useState(false);
  const [texteChat, setTexteChat] = useState("");
  const [ref, setRef] = useState<Referentiel | null>(null);
  const [apiKo, setApiKo] = useState(false);
  const finChat = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let actif = true;
    Promise.all([
      apiGet<{ compte: BanqueCompte; referentiel: Referentiel }>(API.banque),
      apiGet<{ messages: MessageChat[] }>(API.banqueChat()),
    ]).then(([b, c]) => {
      if (!actif) return;
      if (!b.ok) { setApiKo(true); return; }
      setBanque(b.corps.compte);
      setRef(b.corps.referentiel);
      setMessages(c.ok ? c.corps.messages : []);
    });
    return () => { actif = false; };
  }, []);

  useEffect(() => { finChat.current?.scrollIntoView({ block: "nearest" }); }, [messages.length]);

  if (apiKo) {
    return (
      <div className="bg-white rounded-[24px] shadow-card border p-8 text-center">
        <ServerOff className="w-8 h-8 mx-auto text-red-500" aria-hidden="true" />
        <p className="mt-3 text-sm font-bold text-ink">{tr("banque:apiDown")}</p>
        <p className="mt-1 text-[12px] text-slate-400">{tr("banque:demoBadge")}</p>
      </div>
    );
  }
  if (!banque || !ref) return null;

  const envoyerVirement = async () => {
    setErreurEnvoi(null); setOkEnvoi(false);
    const montantNum = Number(montant.replace(",", "."));
    if (!nomBenef.trim()) { setErreurEnvoi("banque:send.err.name"); return; }
    if (!motif.trim()) { setErreurEnvoi("banque:send.err.motif"); return; }
    const r = await apiPost<{ compte?: BanqueCompte }>(API.banque, {
      action: "virement", beneficiaireNom: nomBenef.trim(), beneficiaireIban: ibanBenef.trim(),
      montant: montantNum, motif: motif.trim(),
    });
    if (!r.ok || !r.corps.compte) {
      const cle = r.corps.erreur === "non_verifie" ? "banque:send.locked"
        : r.corps.erreur === "iban_invalide" ? "banque:send.err.iban" : "banque:send.err.amount";
      setErreurEnvoi(cle);
      return;
    }
    setBanque(r.corps.compte);
    setNomBenef(""); setIbanBenef(""); setMontant(""); setMotif(""); setOkEnvoi(true);
  };

  const annulerSurServeur = async (virementId: string) => {
    const r = await apiPost<{ compte?: BanqueCompte }>(API.banque, { action: "annuler", virementId });
    if (r.ok && r.corps.compte) setBanque(r.corps.compte);
  };

  const copierIban = () => {
    navigator.clipboard?.writeText(banque.iban).catch(() => undefined);
    setCopie(true);
    window.setTimeout(() => setCopie(false), 1600);
  };

  const envoyerChat = async () => {
    const texte = texteChat.trim();
    if (!texte) return;
    setTexteChat("");
    const r = await apiPost<{ messages?: MessageChat[] }>(API.banque, { action: "chat", texte });
    if (r.ok && r.corps.messages) setMessages(r.corps.messages);
  };

  const solde = soldeDe(banque);
  const reserve = reserveDe(banque.virements);
  const disponible = disponibleDe(banque);
  const virements = [...banque.virements].reverse();
  const txs = [...banque.transactions].reverse();

  return (
    <div className="space-y-6">
      {/* ——— Solde + IBAN ——— */}
      <div className="bg-ink text-white rounded-[24px] p-6 md:p-8 shadow-card relative overflow-hidden">
        <div className="absolute -right-16 -top-16 w-56 h-56 rounded-full bg-primary/20 blur-3xl" aria-hidden="true" />
        <div className="flex flex-wrap items-start gap-6 justify-between relative">
          <div>
            <div className="text-[11px] font-bold tracking-widest uppercase text-white/50">{tr("banque:balance")}</div>
            <div className="mt-1 font-display font-extrabold text-[40px] leading-none tabular-nums">
              <CountUp a={0} final={formatEUR2(solde, locale)} format={(n) => formatEUR2(n, locale)} declencheur="montage" />
            </div>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[12px] text-white/70">
              <span>{tr("banque:available")} : <strong className="text-white tabular-nums">{formatEUR2(disponible, locale)}</strong></span>
              <span>{tr("banque:reserved")} : <strong className="text-white tabular-nums">{formatEUR2(reserve, locale)}</strong> <span className="text-white/40">({tr("banque:reservedHint")})</span></span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {banque.photo
              ? // eslint-disable-next-line @next/next/no-img-element
                <img src={banque.photo} alt={session.nom} className="w-12 h-12 rounded-2xl object-cover border-2 border-white/20" />
              : <span className="w-12 h-12 rounded-2xl bg-primary grid place-items-center"><UserRound className="w-6 h-6" aria-hidden="true" /></span>}
            <div>
              <div className="font-extrabold leading-tight">{session.nom}</div>
              <div className={cn("mt-0.5 inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider", banque.verifie ? "text-emerald-400" : "text-amber-400")}>
                {banque.verifie ? <BadgeCheck className="w-3.5 h-3.5" aria-hidden="true" /> : <Lock className="w-3.5 h-3.5" aria-hidden="true" />}
                {tr(banque.verifie ? "banque:verified" : "banque:unverified")}
              </div>
            </div>
          </div>
        </div>
        <div className="mt-6 relative flex flex-wrap items-center gap-3 rounded-2xl bg-white/5 border border-white/10 p-4">
          <Landmark className="w-5 h-5 text-primary shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <div className="text-[10px] font-bold tracking-widest uppercase text-white/40">{tr("banque:iban")} — {tr("banque:ibanNote")}</div>
            <div className="font-mono text-[15px] tracking-wider">{banque.iban}</div>
          </div>
          <button type="button" onClick={copierIban} className={buttonClasses("ghost", "sm", "ml-auto")}>
            {copie ? <Check className="w-4 h-4" aria-hidden="true" /> : <Copy className="w-4 h-4" aria-hidden="true" />}
            <span className="ml-2">{tr(copie ? "banque:copied" : "banque:iban")}</span>
          </button>
        </div>
        <p className="mt-4 text-[11px] text-white/40 relative">{tr("banque:demoBadge")}</p>
      </div>

      <div className="grid lg:grid-cols-2 gap-6 items-start">
        {/* ——— Nouveau virement sortant ——— */}
        <div className="bg-white rounded-[24px] shadow-card border p-6">
          <h3 className="font-display font-extrabold text-ink flex items-center gap-2"><ArrowUpRight className="w-5 h-5 text-primary" aria-hidden="true" /> {tr("banque:send.title")}</h3>
          {!banque.verifie ? (
            <div className="mt-4 rounded-2xl bg-amber-50 border border-amber-200 p-4 text-[13px] leading-6 text-amber-800">
              <Lock className="w-4 h-4 inline mr-2 -mt-0.5" aria-hidden="true" />{tr("banque:send.locked")}
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{tr("banque:send.benefName")}</span>
                <input value={nomBenef} onChange={(e) => setNomBenef(e.target.value)} className="mt-1 w-full h-11 rounded-xl border border-slate-200 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </label>
              <label className="block">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{tr("banque:send.benefIban")}</span>
                <input value={ibanBenef} onChange={(e) => setIbanBenef(e.target.value)} placeholder="BE…" className="mt-1 w-full h-11 rounded-xl border border-slate-200 px-4 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{tr("banque:send.amount")}</span>
                  <input value={montant} onChange={(e) => setMontant(e.target.value)} inputMode="decimal" className="mt-1 w-full h-11 rounded-xl border border-slate-200 px-4 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30" />
                </label>
                <label className="block">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{tr("banque:send.motif")}</span>
                  <input value={motif} onChange={(e) => setMotif(e.target.value)} placeholder={tr("banque:send.motifPlaceholder")} className="mt-1 w-full h-11 rounded-xl border border-slate-200 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
                </label>
              </div>
              {erreurEnvoi && <p role="alert" className="text-[13px] font-bold text-red-600">{tr(erreurEnvoi)}</p>}
              {okEnvoi && !erreurEnvoi && <p role="status" className="text-[13px] font-bold text-emerald-600">{tr("banque:send.ok")}</p>}
              <button type="button" onClick={envoyerVirement} className={buttonClasses("primary", "md", "w-full")}>
                <Send className="w-4 h-4" aria-hidden="true" /> <span className="ml-2">{tr("banque:send.cta")}</span>
              </button>
            </div>
          )}
        </div>

        {/* ——— Mouvements du compte ——— */}
        <div className="bg-white rounded-[24px] shadow-card border p-6">
          <h3 className="font-display font-extrabold text-ink flex items-center gap-2"><Landmark className="w-5 h-5 text-primary" aria-hidden="true" /> {tr("banque:tx.title")}</h3>
          {txs.length === 0 ? (
            <p className="mt-4 text-[13px] text-slate-500">{tr("banque:tx.empty")}</p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-100">
              {txs.map((tx) => (
                <li key={tx.id} className="py-3 flex items-center gap-3">
                  <span className={cn("w-9 h-9 rounded-xl grid place-items-center shrink-0", tx.sens === "entrant" ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-500")}>
                    {tx.sens === "entrant" ? <ArrowDownLeft className="w-4 h-4" aria-hidden="true" /> : <ArrowUpRight className="w-4 h-4" aria-hidden="true" />}
                  </span>
                  <div className="min-w-0">
                    <div className="text-[13px] font-bold text-ink truncate">{tx.motifCle ? tr(tx.motifCle) : tSiCle(locale, tx.motifLibre)}</div>
                    <div className="text-[11px] text-slate-400">
                      {tr(tx.sens === "entrant" ? "banque:tx.from" : "banque:tx.to", { nom: tx.contrepartie })} · {formatDateTime(tx.date, locale)}
                    </div>
                  </div>
                  <div className={cn("ml-auto font-extrabold tabular-nums text-sm", tx.sens === "entrant" ? "text-emerald-600" : "text-red-500")}>
                    {tx.sens === "entrant" ? "+" : "−"}{formatEUR2(tx.montant, locale)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ——— Virements sortants avec pipeline ——— */}
      <div className="bg-white rounded-[24px] shadow-card border p-6">
        <h3 className="font-display font-extrabold text-ink flex items-center gap-2"><Send className="w-5 h-5 text-primary" aria-hidden="true" /> {tr("banque:vir.title")}</h3>
        {virements.length === 0 ? (
          <p className="mt-4 text-[13px] text-slate-500">{tr("banque:vir.empty")}</p>
        ) : (
          <ul className="mt-4 space-y-4">
            {virements.map((v) => {
              const blocageActif = v.statut === "BLOQUE" ? v.blocages.find((b) => !b.leveA) : undefined;
              return (
                <li key={v.id} className="rounded-2xl border border-slate-100 p-5">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-extrabold text-ink">{v.beneficiaireNom} · <span className="tabular-nums">{formatEUR2(v.montant, locale)}</span></div>
                      <div className="text-[11px] text-slate-400 font-mono">{v.id} · {v.beneficiaireIban} · {formatDateTime(v.creeA, locale)}</div>
                    </div>
                    <span className={cn("ml-auto text-[11px] font-extrabold uppercase tracking-wider px-3 py-1.5 rounded-full", COULEUR_STATUT[v.statut])}>{tr(CLES_STATUT[v.statut])}</span>
                  </div>
                  <div className="mt-4"><BarrePipeline v={v} ref={ref} tr={tr} /></div>
                  {blocageActif && (
                    <div className="mt-4 rounded-2xl bg-red-50 border border-red-100 p-4 text-[13px] leading-6 text-red-700">
                      <div className="font-extrabold flex items-center gap-2"><ShieldAlert className="w-4 h-4" aria-hidden="true" /> {tr("banque:vir.blockedFor", { defaut: tr(CLES_DEFAUT[blocageActif.code] ?? "") })}</div>
                      <div className="mt-1">{tr("banque:vir.blockedCost", { cout: formatEUR2(blocageActif.cout, locale) })}</div>
                      <div className="mt-1 text-red-600/80">{tr("banque:vir.blockedHint")}</div>
                    </div>
                  )}
                  {(v.statut === "EN_COURS" || v.statut === "BLOQUE") && (
                    <button type="button" onClick={() => void annulerSurServeur(v.id)} className={buttonClasses("outline-light", "sm", "mt-4")}>
                      {tr("banque:vir.cancel")}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ——— Messagerie support ——— */}
      <div className="bg-white rounded-[24px] shadow-card border p-6">
        <h3 className="font-display font-extrabold text-ink flex items-center gap-2"><MessageCircle className="w-5 h-5 text-primary" aria-hidden="true" /> {tr("banque:chat.title")}</h3>
        <div className="mt-4 rounded-2xl bg-surface border p-4 h-56 overflow-y-auto space-y-3">
          {messages.length === 0 && <p className="text-[13px] text-slate-400">{tr("banque:chat.empty")}</p>}
          {messages.map((m) => (
            <div key={m.id} className={cn("max-w-[80%]", m.de === "client" ? "ml-auto" : "")}>
              <div className={cn("rounded-2xl px-4 py-2.5 text-[13px] leading-5", m.de === "client" ? "bg-primary text-white rounded-br-md" : "bg-white border rounded-bl-md text-ink")}>{tSiCle(locale, m.texte)}</div>
              <div className={cn("mt-1 text-[10px] text-slate-400", m.de === "client" ? "text-right" : "")}>
                {m.de === "client" ? tr("banque:chat.you") : tr("banque:chat.support")} · {formatDateTime(m.ts, locale)}
              </div>
            </div>
          ))}
          <div ref={finChat} />
        </div>
        <div className="mt-3 flex gap-2">
          <input
            value={texteChat} onChange={(e) => setTexteChat(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") envoyerChat(); }}
            placeholder={tr("banque:chat.placeholder")}
            className="flex-1 h-11 rounded-xl border border-slate-200 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <button type="button" onClick={envoyerChat} className={buttonClasses("dark", "md")}>
            <Send className="w-4 h-4" aria-hidden="true" /> <span className="ml-2">{tr("banque:chat.send")}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
