"use client";
/**
 * Opérations (ADMIN / SUPER_ADMIN) — slices 8, 11, 12 : **tout passe par l'API serveur**.
 *
 * Quatre sections : « Clients & KYC » (liste des comptes, validation/révocation KYC, ouverture du
 * dossier), « Dossier client » (profil complet servi par le serveur, banque, crédits, virements
 * avec pipeline de validation, chat), « Transactions » (journal tous clients) et « Référentiel »
 * (surcharges serveur des défauts — la table canonique reste `operations/virements.json`).
 * L'UI n'applique jamais une transition : elle envoie des intentions, le serveur applique la
 * machine à états pure de lib/banque.ts.
 */
import { useEffect, useState } from "react";
import {
  ArrowDownLeft, ArrowLeftRight, ArrowUpRight, BadgeCheck, FolderOpen, Landmark,
  Lock, MessageCircle, Send, ServerOff, ShieldAlert, ShieldX, UserRound, Users,
} from "lucide-react";
import { buttonClasses } from "@/components/ui/Button";
import { formatEUR2, cn } from "@/lib/utils";
import { formatDate, formatDateTime } from "@/lib/formatters";
import { Locale, t, tSiCle } from "@/lib/i18n";
import type { Session } from "@/lib/auth";
import { API, apiGet, apiPost } from "@/lib/api";
import {
  disponibleDe, progressionDe, reserveDe, soldeDe,
  type BanqueCompte, type MessageChat, type Referentiel, type SurchargesReferentiel, type Transaction,
} from "@/lib/banque";

const CLES_PIPELINE: Record<string, string> = {
  RECEPTION: "banque:pipeline.RECEPTION", CONFORMITE: "banque:pipeline.CONFORMITE",
  CERTIFICATS: "banque:pipeline.CERTIFICATS", EXECUTION: "banque:pipeline.EXECUTION",
};
const CLES_DEFAUT: Record<string, string> = {
  CERT_ASSURANCE: "banque:defaut.CERT_ASSURANCE", JUSTIF_DOMICILE: "banque:defaut.JUSTIF_DOMICILE",
  ORIGINE_FONDS: "banque:defaut.ORIGINE_FONDS", CAPACITE_INSUFFISANTE: "banque:defaut.CAPACITE_INSUFFISANTE",
};
const CLES_MARITAL = ["single", "married", "cohabiting", "divorced", "widow"];
const CLES_LOGEMENT = ["owner", "tenant", "free"];

interface ClientOps {
  id: string; email: string; nom: string; creeA: string;
  profil: Record<string, string> | null; compte: BanqueCompte;
}
type OngletOps = "clients" | "dossier" | "transactions" | "referentiel";

export default function OpsPortal({ locale, session }: { locale: Locale; session: Session }) {
  const tr = (k: string, vars?: Record<string, string | number>) => t(locale, k, vars);
  const [onglet, setOnglet] = useState<OngletOps>("clients");
  const [clients, setClients] = useState<ClientOps[]>([]);
  const [choisi, setChoisi] = useState<string | null>(null);
  const [ref, setRef] = useState<Referentiel | null>(null);
  const [surcharges, setSurcharges] = useState<SurchargesReferentiel>({});
  const [messages, setMessages] = useState<MessageChat[]>([]);
  const [montantCredit, setMontantCredit] = useState("");
  const [motifCredit, setMotifCredit] = useState("");
  const [msgCredit, setMsgCredit] = useState<"ok" | "err" | null>(null);
  const [texteChat, setTexteChat] = useState("");
  const [pret, setPret] = useState(false);
  const [apiKo, setApiKo] = useState(false);

  const chargerMessages = async (idCompte: string) => {
    const r = await apiGet<{ messages: MessageChat[] }>(API.banqueChat(idCompte));
    setMessages(r.ok ? r.corps.messages : []);
  };
  const rafraichir = () => {
    apiGet<{ clients: ClientOps[]; referentiel: Referentiel; surcharges: SurchargesReferentiel }>(API.banqueComptes).then((r) => {
      if (!r.ok) { setApiKo(true); setPret(true); return; }
      setClients(r.corps.clients);
      setRef(r.corps.referentiel);
      setSurcharges(r.corps.surcharges);
      setChoisi((prev) => prev ?? r.corps.clients[0]?.id ?? null);
      setPret(true);
    });
  };

  useEffect(() => { rafraichir(); }, []);
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

  const crediter = async () => {
    if (!cible) return;
    const montantNum = Number(montantCredit.replace(",", "."));
    if (!(montantNum > 0)) { setMsgCredit("err"); return; }
    const compte = await operation({ action: "crediter", compteId: cible.id, montant: montantNum, motif: motifCredit.trim() });
    if (compte) { setMontantCredit(""); setMotifCredit(""); setMsgCredit("ok"); }
    else setMsgCredit("err");
  };

  const changerSurcharge = async (code: string, patch: { cout?: number; actif?: boolean; pct?: number; motif?: string; creer?: boolean }) => {
    const r = await apiPost<{ referentiel?: Referentiel; surcharges?: SurchargesReferentiel }>(API.banqueReferentiel, { code, ...patch });
    if (r.ok && r.corps.referentiel) {
      setRef(r.corps.referentiel);
      setSurcharges(r.corps.surcharges ?? {});
    }
  };

  /** Libellé d'un niveau : clé canonique, ou « Niveau {pct} % » pour un niveau créé. */
  const libelleNiveau = (code: string, pct: number) =>
    CLES_PIPELINE[code] ? tr(CLES_PIPELINE[code]) : tr("banque:pipeline.custom", { pct });

  /** Créer un nouveau champ de progression : premier code CHAMP_* libre, niveau 50 % par défaut. */
  const ajouterChamp = () => {
    const pris = new Set(ref.defauts.map((d) => d.code));
    let code = "CHAMP_NOUVEAU";
    for (const suf of ["_A", "_B", "_C", "_D", "_E", "_F", "_G", "_H"]) {
      if (!pris.has(`CHAMP${suf}`)) { code = `CHAMP${suf}`; break; }
    }
    void changerSurcharge(code, { creer: true, pct: 50, cout: 0, actif: true, motif: "" });
  };

  const envoyerChat = async () => {
    if (!cible) return;
    const texte = texteChat.trim();
    if (!texte) return;
    setTexteChat("");
    const r = await apiPost<{ messages?: MessageChat[] }>(API.banqueOperations, { action: "chat", compteId: cible.id, texte });
    if (r.ok && r.corps.messages) setMessages(r.corps.messages);
  };

  const aTraiter = (compte: BanqueCompte) => compte.virements.filter((v) => v.statut === "EN_COURS" || v.statut === "BLOQUE");
  const journal: Array<{ client: ClientOps; tx: Transaction }> = clients
    .flatMap((client) => client.compte.transactions.map((tx) => ({ client, tx })))
    .sort((a, b) => b.tx.date.localeCompare(a.tx.date));

  const badgeKyc = (verifie: boolean) => (
    <span className={cn("inline-flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-1 rounded-full", verifie ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600")}>
      {verifie ? <BadgeCheck className="w-3.5 h-3.5" aria-hidden="true" /> : <Lock className="w-3.5 h-3.5" aria-hidden="true" />}
      {tr(verifie ? "banque:verified" : "banque:unverified")}
    </span>
  );

  const barrePipeline = (v: BanqueCompte["virements"][number]) => (
    <div className="mt-3 flex h-2.5 gap-1">
      {(() => { let precedent = 0; return ref.pipeline.map((niveau) => { const largeur = niveau.pct - precedent; precedent = niveau.pct; const pct = progressionDe(v, ref); const fait = pct >= niveau.pct; return (
        <div key={niveau.code} style={{ width: `${largeur}%` }} className="h-full rounded-full bg-slate-100 overflow-hidden" title={libelleNiveau(niveau.code, niveau.pct)}>
          <div className={cn("h-full", v.statut === "BLOQUE" ? "bg-red-500" : v.statut === "EN_COURS" ? "bg-primary" : v.statut === "EXECUTE" ? "bg-emerald-500" : "bg-slate-300")} style={{ width: fait ? "100%" : "0%" }} />
        </div>
      ); }); })()}
    </div>
  );

  const actionsVirement = (id: string, v: BanqueCompte["virements"][number]) => {
    const blocageActif = v.statut === "BLOQUE" ? v.blocages.find((b) => !b.leveA) : undefined;
    return (
      <div className="mt-3">
        {barrePipeline(v)}
        {blocageActif && (
          <div className="mt-3 rounded-xl bg-red-50 border border-red-100 p-3 text-[12px] text-red-700 font-bold flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0" aria-hidden="true" />
            {tr("banque:vir.blockedFor", { defaut: blocageActif.motif ? tSiCle(locale, blocageActif.motif) : tr(CLES_DEFAUT[blocageActif.code] ?? "") })} — {tr("banque:vir.blockedCost", { cout: formatEUR2(blocageActif.cout, locale) })}
          </div>
        )}
        {/* Le code d'arrêt : l'administration le communique au client après règlement du montant. */}
        {v.statut === "BLOQUE" && v.codeDeblocage && (
          <div className="mt-3 rounded-xl bg-ink text-white p-4 flex flex-wrap items-center gap-3">
            <span className="text-[10px] font-bold uppercase tracking-widest text-white/50">{tr("banque:ops.code")}</span>
            <span className="font-mono text-[18px] tracking-[0.3em] text-primary">{v.codeDeblocage}</span>
          </div>
        )}
        {(v.statut === "EN_COURS" || v.statut === "BLOQUE") && (
          <div className="mt-3 flex flex-wrap gap-2">
            {v.statut === "BLOQUE" && (
              <button type="button" onClick={() => void operation({ action: "lever", compteId: id, virementId: v.id })} className={buttonClasses("primary", "sm")}>
                {tr("banque:ops.lift")}
              </button>
            )}
            <button type="button" onClick={() => void operation({ action: "refuser", compteId: id, virementId: v.id })} className={buttonClasses("outline-light", "sm")}>
              {tr("banque:ops.refuse")}
            </button>
          </div>
        )}
      </div>
    );
  };

  const Ligne = ({ cle, valeur }: { cle: string; valeur?: string }) => (valeur ? (
    <div className="flex justify-between gap-3 text-[12px] py-1">
      <span className="text-slate-400 font-bold shrink-0">{tr(cle)}</span>
      <span className="text-ink font-semibold text-right">{valeur}</span>
    </div>
  ) : null);

  const ONGLETS: Array<{ id: OngletOps; cle: string; icone: typeof Users }> = [
    { id: "clients", cle: "banque:ops.tabClients", icone: Users },
    { id: "dossier", cle: "banque:ops.tabDossier", icone: FolderOpen },
    { id: "transactions", cle: "banque:ops.tabTransactions", icone: ArrowLeftRight },
    { id: "referentiel", cle: "banque:ops.tabReferentiel", icone: Landmark },
  ];

  return (
    <div className="space-y-6">
      {/* ——— En-tête + onglets ——— */}
      <div className="bg-white rounded-[24px] shadow-card border p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="font-display font-extrabold text-ink flex items-center gap-2"><ShieldAlert className="w-5 h-5 text-primary" aria-hidden="true" /> {tr("banque:ops.title")}</h3>
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{session.nom} · {session.role}</span>
        </div>
        <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label={tr("banque:ops.title")}>
          {ONGLETS.map((o) => (
            <button key={o.id} type="button" role="tab" aria-selected={onglet === o.id} onClick={() => setOnglet(o.id)}
              className={cn("inline-flex items-center gap-2 h-10 px-4 rounded-full text-[12px] font-extrabold uppercase tracking-wider border transition-colors",
                onglet === o.id ? "bg-ink text-white border-ink" : "bg-white text-slate-500 border-slate-200 hover:border-ink/40")}>
              <o.icone className="w-4 h-4" aria-hidden="true" /> {tr(o.cle)}
            </button>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-slate-400">{tr("banque:demoBadge")}</p>
      </div>

      {/* ——— Clients & KYC ——— */}
      {onglet === "clients" && (
        <div className="bg-white rounded-[24px] shadow-card border p-6 overflow-x-auto">
          <h3 className="font-display font-extrabold text-ink flex items-center gap-2"><Users className="w-5 h-5 text-primary" aria-hidden="true" /> {tr("banque:ops.tabClients")}</h3>
          {clients.length === 0 ? (
            <p className="mt-3 text-[13px] text-slate-500">{tr("banque:ops.noClients")}</p>
          ) : (
            <table className="mt-4 w-full min-w-[720px] text-[13px]">
              <thead>
                <tr className="text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  <th className="pb-2 pr-3">{tr("banque:ops.txClient")}</th>
                  <th className="pb-2 pr-3">KYC</th>
                  <th className="pb-2 pr-3 text-right">{tr("banque:balance")}</th>
                  <th className="pb-2 pr-3 text-right">{tr("banque:ops.virements")}</th>
                  <th className="pb-2 text-right"> </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {clients.map((c) => (
                  <tr key={c.id}>
                    <td className="py-3 pr-3">
                      <div className="font-extrabold text-ink">{c.nom}</div>
                      <div className="text-[11px] text-slate-400">{c.email} · <span className="font-mono">{c.compte.iban}</span></div>
                    </td>
                    <td className="py-3 pr-3">{badgeKyc(c.compte.verifie)}</td>
                    <td className="py-3 pr-3 text-right font-bold tabular-nums">{formatEUR2(soldeDe(c.compte), locale)}</td>
                    <td className="py-3 pr-3 text-right">
                      {aTraiter(c.compte).length > 0
                        ? <span className="inline-flex items-center gap-1 text-[11px] font-extrabold text-primary bg-primary-light px-2.5 py-1 rounded-full">{aTraiter(c.compte).length} {tr("banque:ops.pending")}</span>
                        : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="py-3 text-right whitespace-nowrap">
                      <button type="button"
                        onClick={() => void operation({ action: "verifier", compteId: c.id, verifie: !c.compte.verifie })}
                        className={buttonClasses(c.compte.verifie ? "outline-light" : "primary", "sm")}>
                        {c.compte.verifie ? <ShieldX className="w-4 h-4" aria-hidden="true" /> : <BadgeCheck className="w-4 h-4" aria-hidden="true" />}
                        <span className="ml-2">{tr(c.compte.verifie ? "banque:ops.kycRevoke" : "banque:ops.kycValidate")}</span>
                      </button>
                      <button type="button" onClick={() => { setChoisi(c.id); setOnglet("dossier"); }} className={cn(buttonClasses("outline-light", "sm"), "ml-2")}>
                        <FolderOpen className="w-4 h-4" aria-hidden="true" />
                        <span className="ml-2">{tr("banque:ops.openDossier")}</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ——— Dossier client ——— */}
      {onglet === "dossier" && (
        clients.length === 0 ? (
          <div className="bg-white rounded-[24px] shadow-card border p-6"><p className="text-[13px] text-slate-500">{tr("banque:ops.noClients")}</p></div>
        ) : (
          <>
            <div className="bg-white rounded-[24px] shadow-card border p-6">
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex-1 min-w-[240px] max-w-md">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{tr("banque:ops.select")}</span>
                  <select value={choisi ?? ""} onChange={(e) => setChoisi(e.target.value)} className="mt-1 w-full h-11 rounded-xl border border-slate-200 px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30">
                    {clients.map((c) => <option key={c.id} value={c.id}>{c.nom} — {c.email}</option>)}
                  </select>
                </label>
                {cible && badgeKyc(cible.compte.verifie)}
              </div>
            </div>

            {cible && (
              <>
                {/* Profil KYC + banque */}
                <div className="grid lg:grid-cols-2 gap-6 items-start">
                  <div className="bg-white rounded-[24px] shadow-card border p-6">
                    <h4 className="font-display font-extrabold text-ink flex items-center gap-2"><UserRound className="w-5 h-5 text-primary" aria-hidden="true" /> {tr("banque:ops.dossierIdentity")}</h4>
                    {cible.profil ? (
                      <div className="mt-3">
                        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{tr("banque:ops.dossierIdentity")}</div>
                        <Ligne cle="auth.lastName" valeur={cible.profil.nom} />
                        <Ligne cle="auth.firstName" valeur={cible.profil.prenom} />
                        <Ligne cle="auth.birthDate" valeur={cible.profil.naissance ? formatDate(cible.profil.naissance, locale) : undefined} />
                        <Ligne cle="auth.nationality" valeur={cible.profil.nationalite} />
                        {CLES_MARITAL.includes(cible.profil.marital) && <Ligne cle="auth.maritalLabel" valeur={tr(`auth.marital.${cible.profil.marital}`)} />}
                        <Ligne cle="auth.phoneMobile" valeur={cible.profil.telephone} />
                        <div className="mt-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">{tr("banque:ops.dossierAddress")}</div>
                        <Ligne cle="auth.street" valeur={[cible.profil.rue, cible.profil.numero, cible.profil.boite].filter(Boolean).join(" ")} />
                        <Ligne cle="auth.postalCode" valeur={cible.profil.codePostal} />
                        <Ligne cle="auth.city" valeur={cible.profil.ville} />
                        <Ligne cle="auth.country" valeur={cible.profil.pays} />
                        <div className="mt-4 text-[10px] font-bold uppercase tracking-widest text-slate-400">{tr("banque:ops.dossierActivity")}</div>
                        <Ligne cle="auth.employer" valeur={cible.profil.employeur} />
                        <Ligne cle="auth.jobTitle" valeur={cible.profil.profession} />
                        <Ligne cle="auth.seniority" valeur={cible.profil.anciennete} />
                        <Ligne cle="auth.companyName" valeur={cible.profil.entreprise} />
                        <Ligne cle="auth.vatNumber" valeur={cible.profil.tva} />
                        <Ligne cle="auth.sector" valeur={cible.profil.secteur} />
                        <Ligne cle="auth.monthlyIncomeNet" valeur={cible.profil.revenusNets ? `${cible.profil.revenusNets} €` : undefined} />
                        {CLES_LOGEMENT.includes(cible.profil.logement) && <Ligne cle="auth.housingLabel" valeur={tr(`auth.housing.${cible.profil.logement}`)} />}
                        <Ligne cle="auth.housingCost" valeur={cible.profil.chargeLogement ? `${cible.profil.chargeLogement} €` : undefined} />
                      </div>
                    ) : (
                      <p className="mt-3 text-[13px] text-slate-500">{tr("banque:ops.dossierNoProfil")}</p>
                    )}
                  </div>

                  <div className="space-y-6">
                    <div className="bg-white rounded-[24px] shadow-card border p-6">
                      <h4 className="font-display font-extrabold text-ink flex items-center gap-2"><Landmark className="w-5 h-5 text-primary" aria-hidden="true" /> {tr("banque:ops.dossierBank")}</h4>
                      <div className="mt-3 grid grid-cols-2 gap-3 text-[13px]">
                        <div className="rounded-xl bg-surface border p-3"><div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">IBAN</div><div className="font-mono text-[12px] mt-1 break-all">{cible.compte.iban}</div></div>
                        <div className="rounded-xl bg-surface border p-3"><div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{tr("banque:balance")}</div><div className="font-extrabold tabular-nums mt-1">{formatEUR2(soldeDe(cible.compte), locale)}</div></div>
                        <div className="rounded-xl bg-surface border p-3"><div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{tr("banque:available")}</div><div className="font-extrabold tabular-nums mt-1">{formatEUR2(disponibleDe(cible.compte), locale)}</div></div>
                        <div className="rounded-xl bg-surface border p-3"><div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{tr("banque:reserved")}</div><div className="font-extrabold tabular-nums mt-1">{formatEUR2(reserveDe(cible.compte.virements), locale)}</div></div>
                      </div>
                      <div className="mt-4 rounded-2xl bg-surface border p-4">
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

                    <div className="bg-white rounded-[24px] shadow-card border p-6">
                      <h4 className="font-display font-extrabold text-ink flex items-center gap-2"><MessageCircle className="w-5 h-5 text-primary" aria-hidden="true" /> {tr("banque:ops.chat")}</h4>
                      <div className="mt-4 rounded-2xl bg-surface border p-4 h-44 overflow-y-auto space-y-3">
                        {messages.length === 0 && <p className="text-[13px] text-slate-400">{tr("banque:chat.empty")}</p>}
                        {messages.map((m) => (
                          <div key={m.id} className={cn("max-w-[85%]", m.de === "support" ? "ml-auto" : "")}>
                            <div className={cn("rounded-2xl px-4 py-2.5 text-[13px] leading-5", m.de === "support" ? "bg-ink text-white rounded-br-md" : "bg-white border rounded-bl-md text-ink")}>{tSiCle(locale, m.texte)}</div>
                            <div className={cn("mt-1 text-[10px] text-slate-400", m.de === "support" ? "text-right" : "")}>
                              {m.de === "support" ? tr("banque:chat.support") : m.auteur} · {formatDateTime(m.ts, locale)}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 flex gap-2">
                        <input
                          value={texteChat} onChange={(e) => setTexteChat(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") void envoyerChat(); }}
                          placeholder={tr("banque:chat.placeholder")}
                          className="flex-1 h-11 rounded-xl border border-slate-200 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                        <button type="button" onClick={() => void envoyerChat()} className={buttonClasses("dark", "md")}>
                          <Send className="w-4 h-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Virements du dossier */}
                <div className="bg-white rounded-[24px] shadow-card border p-6">
                  <h4 className="font-display font-extrabold text-ink flex items-center gap-2"><Send className="w-5 h-5 text-primary" aria-hidden="true" /> {tr("banque:ops.virements")}</h4>
                  {cible.compte.virements.length === 0 ? (
                    <p className="mt-3 text-[13px] text-slate-500">{tr("banque:ops.virNone")}</p>
                  ) : (
                    <ul className="mt-4 space-y-4">
                      {cible.compte.virements.map((v) => (
                        <li key={v.id} className="rounded-2xl border border-slate-100 p-5">
                          <div className="flex flex-wrap items-center gap-3">
                            <div className="min-w-0">
                              <div className="text-sm font-extrabold text-ink">{v.beneficiaireNom} · <span className="tabular-nums">{formatEUR2(v.montant, locale)}</span></div>
                              <div className="text-[11px] text-slate-400">{tSiCle(locale, v.motif)} · <span className="font-mono">{v.id} · {v.beneficiaireIban}{v.beneficiaireBic ? ` · ${v.beneficiaireBic}` : ""}</span> · {formatDateTime(v.creeA, locale)}</div>
                              {v.beneficiaireAdresse && <div className="text-[11px] text-slate-400">{tr("banque:send.benefAddress")} : {v.beneficiaireAdresse}</div>}
                            </div>
                            <span className={cn("ml-auto text-[11px] font-extrabold uppercase tracking-wider px-3 py-1.5 rounded-full",
                              v.statut === "BLOQUE" ? "bg-red-50 text-red-600" : v.statut === "EXECUTE" ? "bg-emerald-50 text-emerald-600" : v.statut === "EN_COURS" ? "bg-primary-light text-primary" : "bg-slate-100 text-slate-500")}>
                              {tr(`banque:vir.${v.statut}`)}{v.statut === "EN_COURS" ? ` · ${tr("banque:vir.progress", { pct: progressionDe(v, ref) })}` : ""}
                            </span>
                          </div>
                          {actionsVirement(cible.id, v)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </>
        )
      )}

      {/* ——— Journal des transactions ——— */}
      {onglet === "transactions" && (
        <div className="bg-white rounded-[24px] shadow-card border p-6 overflow-x-auto">
          <h3 className="font-display font-extrabold text-ink flex items-center gap-2"><ArrowLeftRight className="w-5 h-5 text-primary" aria-hidden="true" /> {tr("banque:ops.txJournal")}</h3>
          {journal.length === 0 ? (
            <p className="mt-3 text-[13px] text-slate-500">{tr("banque:ops.txNone")}</p>
          ) : (
            <table className="mt-4 w-full min-w-[760px] text-[13px]">
              <thead>
                <tr className="text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  <th className="pb-2 pr-3">{tr("banque:ops.txDate")}</th>
                  <th className="pb-2 pr-3">{tr("banque:ops.txClient")}</th>
                  <th className="pb-2 pr-3"> </th>
                  <th className="pb-2 pr-3">{tr("banque:send.benefName")}</th>
                  <th className="pb-2 pr-3">{tr("banque:send.motif")}</th>
                  <th className="pb-2 text-right">{tr("banque:send.amount")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {journal.map(({ client, tx }) => (
                  <tr key={`${client.id}-${tx.id}`}>
                    <td className="py-2.5 pr-3 whitespace-nowrap text-slate-500">{formatDateTime(tx.date, locale)}</td>
                    <td className="py-2.5 pr-3 font-bold text-ink">{client.nom}</td>
                    <td className="py-2.5 pr-3">
                      {tx.sens === "entrant"
                        ? <span className="inline-flex items-center gap-1 text-emerald-600"><ArrowDownLeft className="w-4 h-4" aria-hidden="true" /> {tr("banque:tx.in")}</span>
                        : <span className="inline-flex items-center gap-1 text-red-500"><ArrowUpRight className="w-4 h-4" aria-hidden="true" /> {tr("banque:tx.out")}</span>}
                    </td>
                    <td className="py-2.5 pr-3">{tx.contrepartie}</td>
                    <td className="py-2.5 pr-3 text-slate-500">{tx.motifCle ? tr(tx.motifCle) : tSiCle(locale, tx.motifLibre)}</td>
                    <td className={cn("py-2.5 text-right font-extrabold tabular-nums", tx.sens === "entrant" ? "text-emerald-600" : "text-ink")}>
                      {tx.sens === "entrant" ? "+" : "−"}{formatEUR2(tx.montant, locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ——— Référentiel ——— */}
      {onglet === "referentiel" && (
        <div className="bg-white rounded-[24px] shadow-card border p-6">
          <h3 className="font-display font-extrabold text-ink flex items-center gap-2"><Landmark className="w-5 h-5 text-primary" aria-hidden="true" /> {tr("banque:ops.referentiel")}</h3>
          <table className="mt-4 w-full max-w-xl text-[13px]">
            <thead>
              <tr className="text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">
                <th className="pb-2">{tr("banque:pipeline.title")}</th>
                <th className="pb-2 text-right">{tr("banque:ops.refLevel")}</th>
                <th className="pb-2 text-right">{tr("banque:ops.refCost")}</th>
                <th className="pb-2">{tr("banque:ops.refMotif")}</th>
                <th className="pb-2 text-right">{tr("banque:ops.refActif")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ref.defauts.map((d) => (
                <tr key={d.code}>
                  <td className="py-2.5 font-bold text-ink">
                    {CLES_DEFAUT[d.code] ? tr(CLES_DEFAUT[d.code]) : d.motif || d.code}
                    {surcharges[d.code]?.cree && <span className="ml-2 text-[9px] font-extrabold uppercase tracking-widest text-primary bg-primary-light px-1.5 py-0.5 rounded-full">admin</span>}
                  </td>
                  <td className="py-2.5 text-right">
                    <input
                      type="number" min={5} max={100} step={5} value={d.pct}
                      onChange={(e) => void changerSurcharge(d.code, { pct: Math.min(100, Math.max(5, Number(e.target.value) || 5)) })}
                      className="w-16 h-9 rounded-lg border border-slate-200 px-2 text-right text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30"
                      aria-label={tr("banque:ops.refLevel")}
                    />
                  </td>
                  <td className="py-2.5 text-right">
                    <input
                      type="number" min={0} value={d.cout}
                      onChange={(e) => void changerSurcharge(d.code, { cout: Math.max(0, Number(e.target.value) || 0) })}
                      className="w-24 h-9 rounded-lg border border-slate-200 px-2 text-right text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30"
                      aria-label={tr("banque:ops.refCost")}
                    />
                  </td>
                  <td className="py-2.5">
                    <input
                      type="text" value={d.motif ?? (CLES_DEFAUT[d.code] ? tr(CLES_DEFAUT[d.code]) : "")}
                      onChange={(e) => void changerSurcharge(d.code, { motif: e.target.value })}
                      placeholder={tr("banque:ops.refMotif")}
                      className="w-full h-9 rounded-lg border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                      aria-label={tr("banque:ops.refMotif")}
                    />
                  </td>
                  <td className="py-2.5 text-right">
                    <input type="checkbox" checked={d.actif} onChange={(e) => void changerSurcharge(d.code, { actif: e.target.checked })} className="w-4 h-4 accent-primary" aria-label={tr("banque:ops.refActif")} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" onClick={ajouterChamp} className={cn(buttonClasses("outline-light", "sm"), "mt-3")}>
            {tr("banque:ops.refAdd")}
          </button>
          <div className="mt-4 rounded-xl bg-surface border p-3 max-w-xl">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{tr("banque:ops.levels")}</div>
            <ol className="mt-1.5 space-y-1">
              {ref.pipeline.map((n) => (
                <li key={n.code} className="text-[12px] text-slate-600 flex justify-between">
                  <span>{libelleNiveau(n.code, n.pct)}</span><span className="tabular-nums font-bold">{n.pct} %</span>
                </li>
              ))}
            </ol>
          </div>
          <p className="mt-3 text-[11px] text-slate-400">{tr("banque:ops.refNote")}</p>
        </div>
      )}
    </div>
  );
}
