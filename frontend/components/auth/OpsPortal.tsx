"use client";
/**
 * Opérations (ADMIN / SUPER_ADMIN) — slice 8, slice 11 : **tout passe par l'API serveur**.
 * L'administration confirme les niveaux du pipeline de validation, bloque pour un défaut du
 * référentiel (code + coût), lève le blocage, crédite un compte (virement entrant), vérifie un
 * client et répond au chat. Le référentiel canonique vient d'`operations/virements.json`, lu par
 * le serveur ; les surcoûts saisis ici sont des surcharges SERVEUR persistées dans le magasin —
 * visibles par tous les postes, plus de « local à cet appareil ».
 */
import { useEffect, useState } from "react";
import {
  ArrowDownLeft, BadgeCheck, CheckCircle2, Landmark, Lock, MessageCircle, Send, ServerOff,
  ShieldAlert, ShieldX, UserRound,
} from "lucide-react";
import { buttonClasses } from "@/components/ui/Button";
import { formatEUR2, cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/formatters";
import { Locale, t } from "@/lib/i18n";
import type { Session } from "@/lib/auth";
import { API, apiGet, apiPost } from "@/lib/api";
import {
  disponibleDe, progressionDe, soldeDe,
  type BanqueCompte, type MessageChat, type Referentiel, type SurchargesReferentiel,
} from "@/lib/banque";

const CLES_PIPELINE: Record<string, string> = {
  RECEPTION: "banque:pipeline.RECEPTION", CONFORMITE: "banque:pipeline.CONFORMITE",
  CERTIFICATS: "banque:pipeline.CERTIFICATS", EXECUTION: "banque:pipeline.EXECUTION",
};
const CLES_DEFAUT: Record<string, string> = {
  CERT_ASSURANCE: "banque:defaut.CERT_ASSURANCE", JUSTIF_DOMICILE: "banque:defaut.JUSTIF_DOMICILE",
  ORIGINE_FONDS: "banque:defaut.ORIGINE_FONDS", CAPACITE_INSUFFISANTE: "banque:defaut.CAPACITE_INSUFFISANTE",
};

interface ClientOps { id: string; email: string; nom: string; compte: BanqueCompte }

export default function OpsPortal({ locale, session }: { locale: Locale; session: Session }) {
  const tr = (k: string, vars?: Record<string, string | number>) => t(locale, k, vars);
  const [clients, setClients] = useState<ClientOps[]>([]);
  const [choisi, setChoisi] = useState<string | null>(null);
  const [ref, setRef] = useState<Referentiel | null>(null);
  const [surcharges, setSurcharges] = useState<SurchargesReferentiel>({});
  const [messages, setMessages] = useState<MessageChat[]>([]);
  const [montantCredit, setMontantCredit] = useState("");
  const [motifCredit, setMotifCredit] = useState("");
  const [msgCredit, setMsgCredit] = useState<"ok" | "err" | null>(null);
  const [defautChoisi, setDefautChoisi] = useState<Record<string, string>>({});
  const [texteChat, setTexteChat] = useState("");
  const [pret, setPret] = useState(false);
  const [apiKo, setApiKo] = useState(false);

  const chargerMessages = async (idCompte: string) => {
    const r = await apiGet<{ messages: MessageChat[] }>(API.banqueChat(idCompte));
    setMessages(r.ok ? r.corps.messages : []);
  };

  useEffect(() => {
    let actif = true;
    apiGet<{ clients: ClientOps[]; referentiel: Referentiel; surcharges: SurchargesReferentiel }>(API.banqueComptes).then((r) => {
      if (!actif) return;
      if (!r.ok) { setApiKo(true); setPret(true); return; }
      setClients(r.corps.clients);
      setRef(r.corps.referentiel);
      setSurcharges(r.corps.surcharges);
      const premier = r.corps.clients[0]?.id ?? null;
      setChoisi(premier);
      if (premier) void chargerMessages(premier);
      setPret(true);
    });
    return () => { actif = false; };
  }, []);

  useEffect(() => { if (choisi) void chargerMessages(choisi); }, [choisi]);

  if (!pret) return null;
  if (apiKo || !ref) {
    return (
      <div className="bg-white rounded-[24px] shadow-card border p-8 text-center">
        <ServerOff className="w-8 h-8 mx-auto text-red-500" aria-hidden="true" />
        <p className="mt-3 text-sm font-bold text-ink">{tr("banque:apiDown")}</p>
      </div>
    );
  }

  const majCompte = (id: string, compte: BanqueCompte) => {
    setClients((prev) => prev.map((c) => (c.id === id ? { ...c, compte } : c)));
  };

  const operation = async (corps: Record<string, unknown>): Promise<BanqueCompte | null> => {
    const r = await apiPost<{ compte?: BanqueCompte }>(API.banqueOperations, corps);
    if (!r.ok || !r.corps.compte) return null;
    if (typeof corps.compteId === "string") majCompte(corps.compteId, r.corps.compte);
    return r.corps.compte;
  };

  const cible = clients.find((c) => c.id === choisi) ?? null;

  const confirmerProchainNiveau = (id: string, virementId: string) => {
    void operation({ action: "confirmer", compteId: id, virementId });
  };

  const bloquer = (id: string, virementId: string) => {
    const code = defautChoisi[virementId] ?? ref.defauts.find((d) => d.actif)?.code;
    if (!code) return;
    void operation({ action: "bloquer", compteId: id, virementId, codeDefaut: code });
  };

  const crediter = async () => {
    if (!cible) return;
    const montantNum = Number(montantCredit.replace(",", "."));
    if (!(montantNum > 0)) { setMsgCredit("err"); return; }
    const compte = await operation({ action: "crediter", compteId: cible.id, montant: montantNum, motif: motifCredit.trim() });
    if (compte) { setMontantCredit(""); setMotifCredit(""); setMsgCredit("ok"); }
    else setMsgCredit("err");
  };

  const changerSurcharge = async (code: string, patch: { cout?: number; actif?: boolean }) => {
    const r = await apiPost<{ referentiel?: Referentiel; surcharges?: SurchargesReferentiel }>(API.banqueReferentiel, { code, ...patch });
    if (r.ok && r.corps.referentiel) {
      setRef(r.corps.referentiel);
      setSurcharges(r.corps.surcharges ?? {});
    }
  };

  const envoyerChat = async () => {
    if (!cible) return;
    const texte = texteChat.trim();
    if (!texte) return;
    setTexteChat("");
    const r = await apiPost<{ messages?: MessageChat[] }>(API.banqueOperations, { action: "chat", compteId: cible.id, texte });
    if (r.ok && r.corps.messages) setMessages(r.corps.messages);
  };

  const virementsATraiter = (compte: BanqueCompte) => compte.virements.filter((v) => v.statut === "EN_COURS" || v.statut === "BLOQUE");

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-[24px] shadow-card border p-6">
        <h3 className="font-display font-extrabold text-ink flex items-center gap-2"><ShieldAlert className="w-5 h-5 text-primary" aria-hidden="true" /> {tr("banque:ops.title")}</h3>
        {clients.length === 0 ? (
          <p className="mt-3 text-[13px] text-slate-500">{tr("banque:ops.noClients")}</p>
        ) : (
          <label className="mt-4 block max-w-sm">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{tr("banque:ops.select")}</span>
            <select value={choisi ?? ""} onChange={(e) => setChoisi(e.target.value)} className="mt-1 w-full h-11 rounded-xl border border-slate-200 px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30">
              {clients.map((c) => <option key={c.id} value={c.id}>{c.nom} — {c.email}</option>)}
            </select>
          </label>
        )}
        <p className="mt-3 text-[11px] text-slate-400">{tr("banque:demoBadge")}</p>
      </div>

      {cible && (
        <>
          {/* ——— Compte sélectionné ——— */}
          <div className="bg-white rounded-[24px] shadow-card border p-6">
            <div className="flex flex-wrap items-center gap-4">
              {cible.compte.photo
                ? // eslint-disable-next-line @next/next/no-img-element
                  <img src={cible.compte.photo} alt={cible.nom} className="w-12 h-12 rounded-2xl object-cover border" />
                : <span className="w-12 h-12 rounded-2xl bg-primary-light text-primary grid place-items-center"><UserRound className="w-6 h-6" aria-hidden="true" /></span>}
              <div className="min-w-0">
                <div className="font-extrabold text-ink">{cible.nom}</div>
                <div className="text-[12px] text-slate-400 font-mono">{cible.compte.iban}</div>
              </div>
              <div className="ml-auto text-right">
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{tr("banque:ops.account")} — {tr("banque:balance")}</div>
                <div className="font-extrabold text-ink text-xl tabular-nums">{formatEUR2(soldeDe(cible.compte), locale)}</div>
                <div className="text-[11px] text-slate-400">{tr("banque:available")} : {formatEUR2(disponibleDe(cible.compte), locale)}</div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void operation({ action: "verifier", compteId: cible.id, verifie: !cible.compte.verifie })}
                className={buttonClasses(cible.compte.verifie ? "outline-light" : "primary", "sm")}
              >
                {cible.compte.verifie ? <ShieldX className="w-4 h-4" aria-hidden="true" /> : <BadgeCheck className="w-4 h-4" aria-hidden="true" />}
                <span className="ml-2">{tr(cible.compte.verifie ? "banque:ops.unverify" : "banque:ops.verify")}</span>
              </button>
              <span className={cn("inline-flex items-center gap-1 text-[11px] font-extrabold uppercase tracking-wider px-3 py-1.5 rounded-full", cible.compte.verifie ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600")}>
                {cible.compte.verifie ? <BadgeCheck className="w-3.5 h-3.5" aria-hidden="true" /> : <Lock className="w-3.5 h-3.5" aria-hidden="true" />}
                {tr(cible.compte.verifie ? "banque:verified" : "banque:unverified")}
              </span>
            </div>

            {/* Créditer le compte */}
            <div className="mt-5 rounded-2xl bg-surface border p-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2"><ArrowDownLeft className="w-4 h-4 text-emerald-600" aria-hidden="true" /> {tr("banque:ops.credit")}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <input value={montantCredit} onChange={(e) => { setMontantCredit(e.target.value); setMsgCredit(null); }} inputMode="decimal" placeholder={tr("banque:ops.creditAmount")} className="h-11 w-36 rounded-xl border border-slate-200 px-4 text-sm tabular-nums bg-white focus:outline-none focus:ring-2 focus:ring-primary/30" />
                <input value={motifCredit} onChange={(e) => setMotifCredit(e.target.value)} placeholder={tr("banque:ops.creditMotif")} className="h-11 flex-1 min-w-[160px] rounded-xl border border-slate-200 px-4 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30" />
                <button type="button" onClick={() => void crediter()} className={buttonClasses("dark", "md")}>{tr("banque:ops.creditCta")}</button>
              </div>
              {msgCredit === "ok" && <p role="status" className="mt-2 text-[12px] font-bold text-emerald-600">{tr("banque:ops.creditOk")}</p>}
              {msgCredit === "err" && <p role="alert" className="mt-2 text-[12px] font-bold text-red-600">{tr("banque:ops.creditErr")}</p>}
            </div>
          </div>

          {/* ——— Virements à traiter ——— */}
          <div className="bg-white rounded-[24px] shadow-card border p-6">
            <h3 className="font-display font-extrabold text-ink flex items-center gap-2"><Send className="w-5 h-5 text-primary" aria-hidden="true" /> {tr("banque:ops.virements")}</h3>
            {virementsATraiter(cible.compte).length === 0 ? (
              <p className="mt-3 text-[13px] text-slate-500">{tr("banque:ops.virNone")}</p>
            ) : (
              <ul className="mt-4 space-y-4">
                {virementsATraiter(cible.compte).map((v) => {
                  const prochain = ref.pipeline[v.niveau];
                  const blocageActif = v.statut === "BLOQUE" ? v.blocages.find((b) => !b.leveA) : undefined;
                  return (
                    <li key={v.id} className="rounded-2xl border border-slate-100 p-5">
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-extrabold text-ink">{v.beneficiaireNom} · <span className="tabular-nums">{formatEUR2(v.montant, locale)}</span></div>
                          <div className="text-[11px] text-slate-400 font-mono">{v.id} · {v.beneficiaireIban} · {formatDateTime(v.creeA, locale)}</div>
                        </div>
                        <span className={cn("ml-auto text-[11px] font-extrabold uppercase tracking-wider px-3 py-1.5 rounded-full", v.statut === "BLOQUE" ? "bg-red-50 text-red-600" : "bg-primary-light text-primary")}>
                          {tr("banque:vir.progress", { pct: progressionDe(v, ref) })}
                        </span>
                      </div>
                      <div className="mt-4 flex h-2.5 gap-1">
                        {(() => { let precedent = 0; return ref.pipeline.map((niveau) => { const largeur = niveau.pct - precedent; precedent = niveau.pct; const pct = progressionDe(v, ref); const fait = pct >= niveau.pct; return (
                          <div key={niveau.code} style={{ width: `${largeur}%` }} className="h-full rounded-full bg-slate-100 overflow-hidden" title={tr(CLES_PIPELINE[niveau.code] ?? "")}>
                            <div className={cn("h-full", v.statut === "BLOQUE" ? "bg-red-500" : "bg-primary")} style={{ width: fait ? "100%" : "0%" }} />
                          </div>
                        ); }); })()}
                      </div>
                      {blocageActif && (
                        <div className="mt-3 rounded-xl bg-red-50 border border-red-100 p-3 text-[12px] text-red-700 font-bold flex items-center gap-2">
                          <ShieldAlert className="w-4 h-4 shrink-0" aria-hidden="true" />
                          {tr("banque:vir.blockedFor", { defaut: tr(CLES_DEFAUT[blocageActif.code] ?? "") })} — {tr("banque:vir.blockedCost", { cout: formatEUR2(blocageActif.cout, locale) })}
                        </div>
                      )}
                      <div className="mt-4 flex flex-wrap gap-2">
                        {v.statut === "EN_COURS" && prochain && (
                          <button type="button" onClick={() => confirmerProchainNiveau(cible.id, v.id)} className={buttonClasses("primary", "sm")}>
                            <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                            <span className="ml-2">{tr("banque:ops.confirmLevel", { niveau: tr(CLES_PIPELINE[prochain.code] ?? "") })}</span>
                          </button>
                        )}
                        {v.statut === "EN_COURS" && (
                          <>
                            <select
                              value={defautChoisi[v.id] ?? ""}
                              onChange={(e) => setDefautChoisi((p) => ({ ...p, [v.id]: e.target.value }))}
                              className="h-9 rounded-full border border-slate-200 px-3 text-[12px] bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
                              aria-label={tr("banque:ops.block")}
                            >
                              <option value="">{tr("banque:ops.block")}</option>
                              {ref.defauts.filter((d) => d.actif).map((d) => (
                                <option key={d.code} value={d.code}>{tr(CLES_DEFAUT[d.code] ?? "")} — {formatEUR2(d.cout, locale)}</option>
                              ))}
                            </select>
                            <button type="button" onClick={() => bloquer(cible.id, v.id)} className={buttonClasses("outline-light", "sm")}>
                              <ShieldAlert className="w-4 h-4" aria-hidden="true" />
                            </button>
                          </>
                        )}
                        {v.statut === "BLOQUE" && (
                          <button type="button" onClick={() => void operation({ action: "lever", compteId: cible.id, virementId: v.id })} className={buttonClasses("primary", "sm")}>
                            {tr("banque:ops.lift")}
                          </button>
                        )}
                        <button type="button" onClick={() => void operation({ action: "refuser", compteId: cible.id, virementId: v.id })} className={buttonClasses("outline-light", "sm")}>
                          {tr("banque:ops.refuse")}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* ——— Chat + référentiel ——— */}
          <div className="grid lg:grid-cols-2 gap-6 items-start">
            <div className="bg-white rounded-[24px] shadow-card border p-6">
              <h3 className="font-display font-extrabold text-ink flex items-center gap-2"><MessageCircle className="w-5 h-5 text-primary" aria-hidden="true" /> {tr("banque:ops.chat")}</h3>
              <div className="mt-4 rounded-2xl bg-surface border p-4 h-48 overflow-y-auto space-y-3">
                {messages.length === 0 && <p className="text-[13px] text-slate-400">{tr("banque:chat.empty")}</p>}
                {messages.map((m) => (
                  <div key={m.id} className={cn("max-w-[80%]", m.de === "support" ? "ml-auto" : "")}>
                    <div className={cn("rounded-2xl px-4 py-2.5 text-[13px] leading-5", m.de === "support" ? "bg-ink text-white rounded-br-md" : "bg-white border rounded-bl-md text-ink")}>{m.texte}</div>
                    <div className={cn("mt-1 text-[10px] text-slate-400", m.de === "support" ? "text-right" : "")}>
                      {m.de === "support" ? tr("banque:chat.support") : m.auteur} · {formatDateTime(m.ts, locale)}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <input
                  value={texteChat} onChange={(e) => setTexteChat(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") envoyerChat(); }}
                  placeholder={tr("banque:chat.placeholder")}
                  className="flex-1 h-11 rounded-xl border border-slate-200 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <button type="button" onClick={envoyerChat} className={buttonClasses("dark", "md")}>
                  <Send className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="bg-white rounded-[24px] shadow-card border p-6">
              <h3 className="font-display font-extrabold text-ink flex items-center gap-2"><Landmark className="w-5 h-5 text-primary" aria-hidden="true" /> {tr("banque:ops.referentiel")}</h3>
              <table className="mt-4 w-full text-[13px]">
                <thead>
                  <tr className="text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    <th className="pb-2">{tr("banque:pipeline.title")}</th>
                    <th className="pb-2 text-right">{tr("banque:ops.refCost")}</th>
                    <th className="pb-2 text-right">{tr("banque:ops.refActif")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ref.defauts.map((d) => (
                    <tr key={d.code}>
                      <td className="py-2.5 font-bold text-ink">{tr(CLES_DEFAUT[d.code] ?? "")}</td>
                      <td className="py-2.5 text-right">
                        <input
                          type="number" min={0} value={d.cout}
                          onChange={(e) => void changerSurcharge(d.code, { cout: Math.max(0, Number(e.target.value) || 0) })}
                          className="w-24 h-9 rounded-lg border border-slate-200 px-2 text-right text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30"
                          aria-label={tr("banque:ops.refCost")}
                        />
                      </td>
                      <td className="py-2.5 text-right">
                        <input type="checkbox" checked={d.actif} onChange={(e) => void changerSurcharge(d.code, { actif: e.target.checked })} className="w-4 h-4 accent-primary" aria-label={tr("banque:ops.refActif")} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-4 rounded-xl bg-surface border p-3">
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{tr("banque:ops.levels")}</div>
                <ol className="mt-1.5 space-y-1">
                  {ref.pipeline.map((n) => (
                    <li key={n.code} className="text-[12px] text-slate-600 flex justify-between">
                      <span>{tr(CLES_PIPELINE[n.code] ?? "")}</span><span className="tabular-nums font-bold">{n.pct} %</span>
                    </li>
                  ))}
                </ol>
              </div>
              <p className="mt-3 text-[11px] text-slate-400">{tr("banque:ops.refNote")}</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
