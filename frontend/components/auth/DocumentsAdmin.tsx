"use client";
/**
 * Menu « Documents » de l'administration (réservé ADMIN / SUPER_ADMIN).
 *
 * En harmonie avec les pièces ENVOYÉES par les clients : même table du magasin, mêmes codes
 * (`DOCUMENT_CODES` → clés `credit:documents.*`), mêmes statuts et même geste d'approbation que
 * le dossier KYC (l'approbation notifie le client sur ses canaux réels et la mention « approuvé »
 * apparaît dans SON menu Documents). Vue transversale : toutes les pièces de tous les clients,
 * filtrables par client et par statut, rafraîchies comme l'Aperçu (15 s + bouton manuel).
 */
import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, Download, FileCheck2, RefreshCw } from "lucide-react";
import { buttonClasses } from "@/components/ui/Button";
import { formatDateTime } from "@/lib/formatters";
import { Locale, t } from "@/lib/i18n";
import { API, apiGet, apiPost } from "@/lib/api";
import type { DocumentServeur } from "@/lib/serveur";

const CLES_DOC: Record<string, string> = {
  ID: "credit:documents.ID", INCOME_3M: "credit:documents.INCOME_3M", PROOF_ADDRESS: "credit:documents.PROOF_ADDRESS",
  PROPERTY_VALUATION: "credit:documents.PROPERTY_VALUATION", BANK_STATEMENTS_3M: "credit:documents.BANK_STATEMENTS_3M",
  TAX_RETURN_2Y: "credit:documents.TAX_RETURN_2Y", BUSINESS_PLAN: "credit:documents.BUSINESS_PLAN",
};

interface ClientOps { id: string; email: string; nom: string }

export default function DocumentsAdmin({ locale }: { locale: Locale }) {
  const tr = (k: string, vars?: Record<string, string | number>) => t(locale, k, vars);
  const [documents, setDocuments] = useState<DocumentServeur[]>([]);
  const [clients, setClients] = useState<ClientOps[]>([]);
  const [filtreClient, setFiltreClient] = useState("tous");
  const [filtreStatut, setFiltreStatut] = useState<"tous" | "SOUMIS" | "APPROUVE">("tous");
  const [maj, setMaj] = useState<string | null>(null);
  const [msg, setMsg] = useState<"ok" | "err" | null>(null);
  const [pret, setPret] = useState(false);

  const charger = async () => {
    const r = await apiGet<{ documents: DocumentServeur[] }>(API.documents);
    if (r.ok) {
      setDocuments(r.corps.documents);
      setMaj(new Date().toISOString());
    }
  };

  useEffect(() => {
    void charger();
    apiGet<{ clients: ClientOps[] }>(API.banqueComptes).then((r) => {
      if (r.ok) setClients(r.corps.clients);
      setPret(true);
    });
    // Même rythme que l'Aperçu : la vue reste fraîche sans geste de l'admin.
    const id = window.setInterval(() => void charger(), 15_000);
    return () => window.clearInterval(id);
  }, []);

  const nomDe = (email: string) => clients.find((c) => c.email === email)?.nom ?? email;

  const visibles = useMemo(() => {
    return [...documents]
      .filter((d) => (filtreClient === "tous" ? true : d.email === filtreClient))
      .filter((d) => (filtreStatut === "tous" ? true : d.statut === filtreStatut))
      .sort((a, b) => b.creeA.localeCompare(a.creeA));
  }, [documents, filtreClient, filtreStatut]);

  const enAttente = useMemo(() => documents.filter((d) => d.statut === "SOUMIS").length, [documents]);
  const approuves = useMemo(() => documents.filter((d) => d.statut === "APPROUVE").length, [documents]);

  const approuver = async (documentId: string) => {
    setMsg(null);
    const r = await apiPost<{ document?: DocumentServeur }>(API.documents, { action: "approuver", documentId });
    if (r.ok && r.corps.document) {
      const neuf = r.corps.document;
      setDocuments((prev) => prev.map((d) => (d.id === neuf.id ? neuf : d)));
      setMsg("ok");
    } else setMsg("err");
  };

  if (!pret) return null;
  const champ = "h-11 rounded-xl border border-slate-200 px-4 text-sm bg-white text-ink focus:outline-none focus:ring-2 focus:ring-primary/30";

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-[24px] shadow-card border p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="font-display font-extrabold text-ink flex items-center gap-2">
            <FileCheck2 className="w-5 h-5 text-primary" aria-hidden="true" /> {tr("dashboard.documentsAdmin.title")}
          </h3>
          <button type="button" onClick={() => void charger()} className={buttonClasses("outline-light", "sm")} aria-label={tr("dashboard.documentsAdmin.refresh")}>
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
          </button>
          {maj && <span className="text-[11px] text-slate-400 tabular-nums">{tr("dashboard.documentsAdmin.updatedAt", { date: formatDateTime(maj, locale) })}</span>}
          <span className="ml-auto flex gap-2">
            <span className="text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-1 rounded-full bg-amber-50 text-amber-600 tabular-nums">
              {tr("dashboard.documentsAdmin.pending", { n: enAttente })}
            </span>
            <span className="text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-600 tabular-nums">
              {tr("dashboard.documentsAdmin.approvedCount", { n: approuves })}
            </span>
          </span>
        </div>
        <p className="mt-1 text-[12px] text-slate-400">{tr("dashboard.documentsAdmin.intro")}</p>
        <div className="mt-4 grid sm:grid-cols-2 gap-3 max-w-2xl">
          <label>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{tr("dashboard.documentsAdmin.client")}</span>
            <select value={filtreClient} onChange={(e) => setFiltreClient(e.target.value)} className={`${champ} mt-1 w-full`}>
              <option value="tous">{tr("dashboard.documentsAdmin.allClients")}</option>
              {clients.map((c) => <option key={c.id} value={c.email}>{c.nom} — {c.email}</option>)}
            </select>
          </label>
          <label>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{tr("dashboard.documentsAdmin.status")}</span>
            <select value={filtreStatut} onChange={(e) => setFiltreStatut(e.target.value as "tous" | "SOUMIS" | "APPROUVE")} className={`${champ} mt-1 w-full`}>
              <option value="tous">{tr("dashboard.documentsAdmin.allStatus")}</option>
              <option value="SOUMIS">{tr("documents.status.PENDING")}</option>
              <option value="APPROUVE">{tr("documents.status.APPROVED")}</option>
            </select>
          </label>
        </div>
      </div>

      <div className="bg-white rounded-[24px] shadow-card border p-6">
        {visibles.length === 0 ? (
          <p className="text-[13px] text-slate-500">{tr("dashboard.documentsAdmin.empty")}</p>
        ) : (
          <ul className="space-y-3">
            {visibles.map((doc) => (
              <li key={doc.id} className="rounded-2xl border border-slate-100 p-4 flex flex-wrap items-center gap-3">
                <div className="min-w-0">
                  <div className="text-[13px] font-extrabold text-ink">
                    {nomDe(doc.email)} · {CLES_DOC[doc.code] ? tr(CLES_DOC[doc.code]) : doc.code} · {doc.nom}
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
                <span className={`ml-auto text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-1 rounded-full ${doc.statut === "APPROUVE" ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"}`}>
                  {tr(doc.statut === "APPROUVE" ? "documents.status.APPROVED" : "documents.status.PENDING")}
                </span>
                <div className="w-full flex flex-wrap items-center gap-2">
                  <a href={doc.donnees} download={doc.nom} className={buttonClasses("outline-light", "sm")}>
                    <Download className="w-4 h-4" aria-hidden="true" /> <span className="ml-2">{tr("banque:ops.docsOpen")}</span>
                  </a>
                  {doc.statut === "SOUMIS" && (
                    <button type="button" onClick={() => void approuver(doc.id)} className={buttonClasses("primary", "sm")}>
                      <BadgeCheck className="w-4 h-4" aria-hidden="true" /> <span className="ml-2">{tr("banque:ops.docsApprove")}</span>
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {msg === "ok" && <p role="status" className="mt-3 text-[12px] font-bold text-emerald-600">{tr("dashboard.documentsAdmin.approveOk")}</p>}
        {msg === "err" && <p role="alert" className="mt-3 text-[12px] font-bold text-red-600">{tr("dashboard.documentsAdmin.approveErr")}</p>}
      </div>
    </div>
  );
}
