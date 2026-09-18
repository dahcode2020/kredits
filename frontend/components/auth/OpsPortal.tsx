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
  ArrowDownLeft, ArrowLeftRight, ArrowUpRight, BadgeCheck, Bell, FileCheck2, FolderOpen, Landmark,
  Lock, MessageCircle, Send, ServerOff, ShieldAlert, ShieldX, UserRound, Users,
} from "lucide-react";
import { buttonClasses } from "@/components/ui/Button";
import { BarrePipeline } from "@/components/auth/BankPortal";
import { formatEUR2, cn } from "@/lib/utils";
import { formatDate, formatDateTime } from "@/lib/formatters";
import { Locale, t, tSiCle } from "@/lib/i18n";
import type { Session } from "@/lib/auth";
import { API, apiGet, apiPost } from "@/lib/api";
import {
  disponibleDe, progressionDe, reserveDe, soldeDe,
  type BanqueCompte, type MessageChat, type Referentiel, type SurchargesReferentiel, type Transaction,
} from "@/lib/banque";
import type { DocumentServeur, NotificationServeur, PaiementServeur, TypePaiement } from "@/lib/serveur";
import type { DOCUMENT_CODES } from "@/lib/credit-engine";

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
const CLES_DOC: Record<(typeof DOCUMENT_CODES)[number], string> = {
  ID: "credit:documents.ID", INCOME_3M: "credit:documents.INCOME_3M", PROOF_ADDRESS: "credit:documents.PROOF_ADDRESS",
  PROPERTY_VALUATION: "credit:documents.PROPERTY_VALUATION", BANK_STATEMENTS_3M: "credit:documents.BANK_STATEMENTS_3M",
  TAX_RETURN_2Y: "credit:documents.TAX_RETURN_2Y", BUSINESS_PLAN: "credit:documents.BUSINESS_PLAN",
};

interface ClientOps {
  id: string; email: string; nom: string; creeA: string;
  profil: Record<string, string> | null; compte: BanqueCompte;
  /** Le KYC se valide dossier en mains : pièces encore à approuver, dernier mot du chat au client. */
  docsEnAttente: number; chatNonLu: boolean;
}
type OngletOps = "clients" | "dossier" | "transactions" | "referentiel" | "notifications";

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
  const [focusDocs, setFocusDocs] = useState(false);
  const [paiements, setPaiements] = useState<PaiementServeur[]>([]);
  const [documents, setDocuments] = useState<DocumentServeur[]>([]);
  const [chargeType, setChargeType] = useState<TypePaiement>("FRAIS");
  const [chargeMontant, setChargeMontant] = useState("");
  const [chargeLibelle, setChargeLibelle] = useState("");
  const [chargeEcheance, setChargeEcheance] = useState("");
  const [msgCharge, setMsgCharge] = useState<"ok" | "err" | null>(null);
  const [pret, setPret] = useState(false);
  const [apiKo, setApiKo] = useState(false);
  const [notifsStaff, setNotifsStaff] = useState<NotificationServeur[]>([]);

  const chargerMessages = async (idCompte: string) => {
    const r = await apiGet<{ messages: MessageChat[] }>(API.banqueChat(idCompte));
    setMessages(r.ok ? r.corps.messages : []);
  };
  /** Paiements & charges du dossier ouvert (le client les voit dans SON menu Paiements). */
  const chargerPaiements = async (idCompte: string) => {
    const r = await apiGet<{ paiements: PaiementServeur[] }>(`${API.paiements}?compte=${encodeURIComponent(idCompte)}`);
    setPaiements(r.ok ? r.corps.paiements : []);
  };
  /** Documents téléversés par le client : l'admin les ouvre, puis les approuve. */
  const chargerDocuments = async (idCompte: string) => {
    const r = await apiGet<{ documents: DocumentServeur[] }>(`${API.documents}?compte=${encodeURIComponent(idCompte)}`);
    setDocuments(r.ok ? r.corps.documents : []);
  };
  const approuverDoc = async (documentId: string) => {
    const r = await apiPost<{ document?: DocumentServeur }>(API.documents, { action: "approuver", documentId });
    if (r.ok && r.corps.document) {
      const neuf = r.corps.document;
      setDocuments((prev) => prev.map((x) => (x.id === neuf.id ? neuf : x)));
    }
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
  /** Réponses des clients dans le chat : chaque membre du personnel a sa propre liste. */
  const chargerNotifs = () => {
    apiGet<{ notifications: NotificationServeur[] }>(API.notifications).then((r) => {
      if (!r.ok) return;
      setNotifsStaff([...r.corps.notifications].sort((a, b) => b.creeA.localeCompare(a.creeA)));
    });
  };

  useEffect(() => { rafraichir(); chargerNotifs(); }, []);
  useEffect(() => {
    if (choisi) { void chargerMessages(choisi); void chargerPaiements(choisi); void chargerDocuments(choisi); }
  }, [choisi]);
  // Le bouton « Pièces du client » amène directement à la carte des documents du dossier ouvert :
  // l'approbation KYC se fait dossier en mains, sans changer d'écran.
  useEffect(() => {
    if (focusDocs && onglet === "dossier" && choisi) {
      const t = window.setTimeout(() => {
        document.getElementById("dossier-docs")?.scrollIntoView({ behavior: "auto", block: "start" });
        setFocusDocs(false);
      }, 80);
      return () => window.clearTimeout(t);
    }
  }, [focusDocs, onglet, choisi]);
  useEffect(() => {
    // L'onglet Notifications se recharge à chaque ouverture (les réponses clients arrivent en direct).
    if (onglet === "notifications") chargerNotifs();
  }, [onglet]);

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
    if (compte) { setMontantCredit(""); setMotifCredit(""); setMsgCredit("ok"); void chargerPaiements(cible.id); }
    else setMsgCredit("err");
  };

  /** Créer une mensualité / des frais : le client la voit « en attente de paiement ». */
  const creerCharge = async () => {
    if (!cible) return;
    setMsgCharge(null);
    const montantNum = Number(chargeMontant.replace(",", "."));
    if (!(montantNum > 0) || !chargeLibelle.trim()) { setMsgCharge("err"); return; }
    const r = await apiPost<{ paiement?: PaiementServeur }>(API.paiements, {
      action: "creer", compteId: cible.id, type: chargeType, montant: montantNum,
      libelle: chargeLibelle.trim(), echeance: chargeEcheance.trim() || undefined,
    });
    if (r.ok && r.corps.paiement) {
      setPaiements((prev) => [...prev, r.corps.paiement!]);
      setChargeMontant(""); setChargeLibelle(""); setChargeEcheance(""); setMsgCharge("ok");
    } else setMsgCharge("err");
  };

  /** Marquer la charge payée : le client le constate dans son propre menu Paiements. */
  const confirmerPaiementAdmin = async (paiementId: string) => {
    const r = await apiPost<{ paiement?: PaiementServeur }>(API.paiements, { action: "confirmer", paiementId });
    if (r.ok && r.corps.paiement) {
      const neuf = r.corps.paiement;
      setPaiements((prev) => prev.map((p) => (p.id === neuf.id ? neuf : p)));
    }
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

  const actionsVirement = (id: string, v: BanqueCompte["virements"][number]) => {
    const blocageActif = v.statut === "BLOQUE" ? v.blocages.find((b) => !b.leveA) : undefined;
    return (
      <div className="mt-3">
        {ref && <BarrePipeline v={v} referentiel={ref} tr={tr} />}
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
    { id: "notifications", cle: "banque:ops.tabNotifications", icone: Bell },
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
              {o.id === "notifications" && notifsStaff.length > 0 && (
                <span className="ml-1 inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-primary text-white text-[10px] tabular-nums" aria-label={String(notifsStaff.length)}>{notifsStaff.length}</span>
              )}
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
                      <div className="font-extrabold text-ink flex items-center gap-2">
                        {c.nom}
                        {/* Le dernier mot du chat revient au client : signalé pour répondre vite. */}
                        {c.chatNonLu && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wider text-primary bg-primary-light px-2 py-0.5 rounded-full" title={tr("banque:ops.chatNonLu")}>
                            <MessageCircle className="w-3 h-3" aria-hidden="true" /> {tr("banque:ops.chatNonLu")}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400">{c.email} · <span className="font-mono">{c.compte.iban}</span></div>
                    </td>
                    <td className="py-3 pr-3">
                      <div className="flex flex-col items-start gap-1.5">
                        {badgeKyc(c.compte.verifie)}
                        {/* Le KYC se valide dossier en mains : pièces restant à approuver. */}
                        <span className={cn("inline-flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full",
                          c.docsEnAttente > 0 ? "bg-amber-50 text-amber-600" : "bg-slate-50 text-slate-400")}>
                          <FileCheck2 className="w-3 h-3" aria-hidden="true" />
                          {c.docsEnAttente > 0 ? tr("banque:ops.docsPending", { n: c.docsEnAttente }) : tr("banque:ops.docsNone")}
                        </span>
                      </div>
                    </td>
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
                      {/* Accès direct aux pièces fournies par le client : approbation en temps réel. */}
                      <button type="button" onClick={() => { setChoisi(c.id); setOnglet("dossier"); setFocusDocs(true); }} className={cn(buttonClasses("outline-light", "sm"), "ml-2")}>
                        <FileCheck2 className="w-4 h-4" aria-hidden="true" />
                        <span className="ml-2">{tr("banque:ops.docsCta")}</span>
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
                {/* Le KYC se valide dossier en mains : lien direct vers les pièces du client. */}
                {cible && cible.docsEnAttente > 0 && (
                  <button type="button" onClick={() => setFocusDocs(true)}
                    className="inline-flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-wider text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2 rounded-full hover:bg-amber-100 transition-colors"
                    title={tr("banque:ops.kycDocsHint")}>
                    <FileCheck2 className="w-4 h-4" aria-hidden="true" />
                    {tr("banque:ops.docsPending", { n: cible.docsEnAttente })}
                  </button>
                )}
              </div>
              {cible && cible.docsEnAttente > 0 && (
                <p className="mt-3 text-[12px] leading-5 text-slate-500">{tr("banque:ops.kycDocsHint")}</p>
              )}
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
                      <p className="mt-1 text-[11px] text-slate-400">{tr("banque:chat.retention")}</p>
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
                          className="flex-1 h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary/30"
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

                {/* Paiements & charges : créés ici, réglés par le client, confirmés ici. */}
                <div className="bg-white rounded-[24px] shadow-card border p-6">
                  <h4 className="font-display font-extrabold text-ink flex items-center gap-2"><ArrowDownLeft className="w-5 h-5 text-primary" aria-hidden="true" /> {tr("banque:ops.payTitle")}</h4>
                  {paiements.length === 0 ? (
                    <p className="mt-3 text-[13px] text-slate-500">{tr("banque:ops.payNone")}</p>
                  ) : (
                    <ul className="mt-4 space-y-3">
                      {[...paiements].sort((a, b) => b.creeA.localeCompare(a.creeA)).map((p) => (
                        <li key={p.id} className="rounded-2xl border border-slate-100 p-4 flex flex-wrap items-center gap-3">
                          <div className="min-w-0">
                            <div className="text-[13px] font-extrabold text-ink">{tSiCle(locale, p.libelle)}</div>
                            <div className="text-[11px] text-slate-400 tabular-nums">
                              {tr(`payments.type.${p.type}`)} · {formatDateTime(p.creeA, locale)}
                              {p.echeance ? ` · ${tr("payments.dueOn", { date: p.echeance })}` : ""}
                              {p.demandeId ? ` · ${p.demandeId}` : ""}
                            </div>
                          </div>
                          <div className="ml-auto text-right">
                            <div className="font-extrabold tabular-nums text-ink">{formatEUR2(p.montant, locale)}</div>
                            <span className={cn("mt-1 inline-block text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-1 rounded-full",
                              p.statut === "PAYE" ? "bg-emerald-50 text-emerald-600" : p.statut === "DECLARE" ? "bg-primary-light text-primary" : "bg-amber-50 text-amber-600")}>
                              {tr(`payments.flow.${p.statut}`)}
                            </span>
                          </div>
                          {p.statut !== "PAYE" && (
                            <div className="w-full flex flex-wrap items-center gap-2">
                              {p.statut === "DECLARE" && <span className="text-[11px] font-bold text-primary">{tr("banque:ops.payDeclared")}</span>}
                              <button type="button" onClick={() => void confirmerPaiementAdmin(p.id)} className={cn(buttonClasses("primary", "sm"), "ml-auto")}>
                                {tr("banque:ops.payConfirm")}
                              </button>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-4 rounded-2xl bg-surface border p-4">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{tr("banque:ops.payCreate")}</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <select value={chargeType} onChange={(e) => setChargeType(e.target.value as TypePaiement)} aria-label={tr("banque:ops.payType")} className="h-11 rounded-xl border border-slate-200 px-3 text-sm bg-white text-ink focus:outline-none focus:ring-2 focus:ring-primary/30">
                        <option value="FRAIS">{tr("payments.type.FRAIS")}</option>
                        <option value="MENSUALITE">{tr("payments.type.MENSUALITE")}</option>
                      </select>
                      <input value={chargeMontant} onChange={(e) => { setChargeMontant(e.target.value); setMsgCharge(null); }} inputMode="decimal" placeholder={tr("banque:ops.payAmountPh")} className="h-11 w-32 rounded-xl border border-slate-200 px-4 text-sm tabular-nums bg-white text-ink focus:outline-none focus:ring-2 focus:ring-primary/30" />
                      <input value={chargeLibelle} onChange={(e) => { setChargeLibelle(e.target.value); setMsgCharge(null); }} placeholder={tr("banque:ops.payLabelPh")} className="h-11 flex-1 min-w-[200px] rounded-xl border border-slate-200 px-4 text-sm bg-white text-ink focus:outline-none focus:ring-2 focus:ring-primary/30" />
                      <input value={chargeEcheance} onChange={(e) => setChargeEcheance(e.target.value)} placeholder={tr("banque:ops.payDuePh")} className="h-11 w-56 rounded-xl border border-slate-200 px-4 text-sm bg-white text-ink focus:outline-none focus:ring-2 focus:ring-primary/30" />
                      <button type="button" onClick={() => void creerCharge()} className={buttonClasses("dark", "md")}>{tr("banque:ops.payCreateCta")}</button>
                    </div>
                    {msgCharge === "ok" && <p role="status" className="mt-2 text-[12px] font-bold text-emerald-600">{tr("banque:ops.payCreated")}</p>}
                    {msgCharge === "err" && <p role="alert" className="mt-2 text-[12px] font-bold text-red-600">{tr("banque:ops.payErr")}</p>}
                  </div>
                </div>

                {/* Documents du client : lire la pièce déposée, puis l'approuver — le client
                    est notifié et la mention « approuvé » apparaît dans son menu Documents. */}
                <div id="dossier-docs" className="bg-white rounded-[24px] shadow-card border p-6 scroll-mt-24">
                  <h4 className="font-display font-extrabold text-ink flex items-center gap-2"><FileCheck2 className="w-5 h-5 text-primary" aria-hidden="true" /> {tr("banque:ops.docsTitle")}</h4>
                  {documents.length === 0 ? (
                    <p className="mt-3 text-[13px] text-slate-500">{tr("banque:ops.docsNone")}</p>
                  ) : (
                    <ul className="mt-4 space-y-3">
                      {[...documents].sort((a, b) => b.creeA.localeCompare(a.creeA)).map((doc) => (
                        <li key={doc.id} className="rounded-2xl border border-slate-100 p-4 flex flex-wrap items-center gap-3">
                          <div className="min-w-0">
                            <div className="text-[13px] font-extrabold text-ink">
                              {(CLES_DOC as Record<string, string>)[doc.code] ? tr((CLES_DOC as Record<string, string>)[doc.code]) : doc.code} · {doc.nom}
                            </div>
                            <div className="text-[11px] text-slate-400 tabular-nums">
                              {doc.demandeId} · {formatDateTime(doc.creeA, locale)} · {Math.max(1, Math.round(doc.taille / 1024))} Ko
                            </div>
                            {doc.statut === "APPROUVE" && doc.approuveA && (
                              <div className="text-[11px] text-emerald-600 font-bold">
                                {tr("documents.approvedBy", { nom: doc.approuvePar ?? "", date: formatDateTime(doc.approuveA, locale) })}
                              </div>
                            )}
                          </div>
                          <span className={cn("ml-auto text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-1 rounded-full",
                            doc.statut === "APPROUVE" ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600")}>
                            {tr(doc.statut === "APPROUVE" ? "documents.status.APPROVED" : "documents.status.PENDING")}
                          </span>
                          <div className="w-full flex flex-wrap items-center gap-2">
                            <a href={doc.donnees} download={doc.nom} className={buttonClasses("outline-light", "sm")}>
                              {tr("banque:ops.docsOpen")}
                            </a>
                            {doc.statut === "SOUMIS" ? (
                              <button type="button" onClick={() => void approuverDoc(doc.id)} className={buttonClasses("primary", "sm")}>
                                <BadgeCheck className="w-4 h-4" aria-hidden="true" /> <span className="ml-2">{tr("banque:ops.docsApprove")}</span>
                              </button>
                            ) : (
                              <span className="text-[11px] text-slate-400">{tr("banque:ops.docsApproved")}</span>
                            )}
                          </div>
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
                      className="w-16 h-9 rounded-lg border border-slate-200 bg-white px-2 text-right text-sm text-ink tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30"
                      aria-label={tr("banque:ops.refLevel")}
                    />
                  </td>
                  <td className="py-2.5 text-right">
                    <input
                      type="number" min={0} value={d.cout}
                      onChange={(e) => void changerSurcharge(d.code, { cout: Math.max(0, Number(e.target.value) || 0) })}
                      className="w-24 h-9 rounded-lg border border-slate-200 bg-white px-2 text-right text-sm text-ink tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30"
                      aria-label={tr("banque:ops.refCost")}
                    />
                  </td>
                  <td className="py-2.5">
                    <input
                      type="text" value={d.motif ?? (CLES_DEFAUT[d.code] ? tr(CLES_DEFAUT[d.code]) : "")}
                      onChange={(e) => void changerSurcharge(d.code, { motif: e.target.value })}
                      placeholder={tr("banque:ops.refMotif")}
                      className="w-full h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary/30"
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

      {/* ——— Notifications du personnel (réponses des clients dans le chat) ——— */}
      {onglet === "notifications" && (
        <div className="bg-white rounded-[24px] shadow-card border p-6">
          <h3 className="font-display font-extrabold text-ink flex items-center gap-2"><Bell className="w-5 h-5 text-primary" aria-hidden="true" /> {tr("banque:ops.tabNotifications")}</h3>
          {notifsStaff.length === 0 && <p className="mt-4 text-[13px] text-slate-400">{tr("notifications:empty")}</p>}
          <ul className="mt-4 space-y-2">
            {notifsStaff.map((n) => {
              const varsResolues: Record<string, string> = {};
              for (const [k, v] of Object.entries(n.vars ?? {})) varsResolues[k] = tSiCle(locale, v);
              return (
                <li key={n.id} className="rounded-2xl bg-surface border p-4">
                  <div className="text-[13px] font-semibold text-ink">{t(locale, n.cle, varsResolues)}</div>
                  <div className="mt-1 text-[11px] text-slate-400 tabular-nums">{formatDateTime(n.creeA, locale)}</div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
