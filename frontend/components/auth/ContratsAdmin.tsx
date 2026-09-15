"use client";
/**
 * Slice 23 — Gestion des contrats des clients (réservé ADMIN / SUPER_ADMIN).
 *
 * Remplace le menu « Mes demandes » de l'administration : on établit un contrat pour un client
 * (mensualité TOUJOURS calculée par le serveur), on ajoute des mentions, on le met à jour, on le
 * télécharge après aperçu (fichier HTML autonome) et on le notifie au client — la distribution
 * réelle (site + e-mail + WhatsApp selon ses préférences) est assurée par le serveur.
 */
import { useEffect, useMemo, useState } from "react";
import { Download, FileSignature, FileText, Plus, Send, X } from "lucide-react";
import { buttonClasses } from "@/components/ui/Button";
import { formatEUR2, cn } from "@/lib/utils";
import { formatDateTime, formatDate, formatNumber } from "@/lib/formatters";
import { Locale, t, tSiCle } from "@/lib/i18n";
import { API, apiGet, apiPost } from "@/lib/api";
import type { ContratServeur } from "@/lib/serveur";

interface ClientOps { id: string; email: string; nom: string }
interface DemandeApercu { id: string; email: string }

/** Copie d'affichage de la formule du serveur (`mensualiteContrat`, lib/serveur.ts, module Node
 *  non importable ici) : la mensualité affichée pendant la saisie ; le serveur recalcule et fait
 *  foi — jamais une valeur saisie à la main. */
function mensualiteAffichage(montant: number, dureeMois: number, tauxAnnuel: number): number {
  if (!(montant > 0) || !Number.isInteger(dureeMois) || dureeMois <= 0 || !(tauxAnnuel >= 0)) return 0;
  const r = tauxAnnuel / 100 / 12;
  const brute = r === 0 ? montant / dureeMois : (montant * r) / (1 - Math.pow(1 + r, -dureeMois));
  return Math.round(brute * 100) / 100;
}
/** Échappement strict pour le document téléchargé (les mentions viennent de la saisie). */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export default function ContratsAdmin({ locale }: { locale: Locale }) {
  const tr = (k: string, vars?: Record<string, string | number>) => t(locale, k, vars);
  const [clients, setClients] = useState<ClientOps[]>([]);
  const [choisi, setChoisi] = useState<string | null>(null);
  const [contrats, setContrats] = useState<ContratServeur[]>([]);
  const [demandes, setDemandes] = useState<DemandeApercu[]>([]);
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [msg, setMsg] = useState<"ok" | "err" | null>(null);
  const [msgNotif, setMsgNotif] = useState<"ok" | "err" | null>(null);
  const [pret, setPret] = useState(false);
  // Formulaire (création ou mise à jour).
  const [objet, setObjet] = useState("");
  const [montant, setMontant] = useState("");
  const [duree, setDuree] = useState("");
  const [taux, setTaux] = useState("");
  const [demandeId, setDemandeId] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [mention, setMention] = useState("");

  const cible = clients.find((c) => c.id === choisi) ?? null;
  const contratOuvert = contrats.find((c) => c.id === ouvert) ?? null;

  const chargerContrats = async (idCompte: string) => {
    const r = await apiGet<{ contrats: ContratServeur[] }>(`${API.contrats}?compte=${encodeURIComponent(idCompte)}`);
    setContrats(r.ok ? r.corps.contrats : []);
  };
  const chargerDemandes = async (email: string) => {
    const r = await apiGet<{ demandes: DemandeApercu[] }>(`${API.demandes}?compte=${encodeURIComponent(email)}`);
    setDemandes(r.ok ? r.corps.demandes : []);
  };

  useEffect(() => {
    apiGet<{ clients: ClientOps[] }>(API.banqueComptes).then((r) => {
      if (r.ok) {
        setClients(r.corps.clients);
        setChoisi((prev) => prev ?? r.corps.clients[0]?.id ?? null);
      }
      setPret(true);
    });
  }, []);
  useEffect(() => {
    if (!choisi) return;
    void chargerContrats(choisi);
    const email = choisi.split("::")[0];
    void chargerDemandes(email);
    setOuvert(null);
    // Nouveau contrat vierge à chaque changement de client.
    setObjet(""); setMontant(""); setDuree(""); setTaux(""); setDemandeId(""); setMentions([]); setMention("");
    setMsg(null); setMsgNotif(null);
  }, [choisi]);

  const mensAffichee = useMemo(
    () => mensualiteAffichage(Number(montant.replace(",", ".")), Number(duree), Number(taux.replace(",", "."))),
    [montant, duree, taux],
  );

  const ajouterMention = () => {
    const m = mention.trim();
    if (!m || mentions.length >= 12) return;
    setMentions([...mentions, m.slice(0, 300)]);
    setMention("");
  };
  const creer = async () => {
    if (!cible) return;
    setMsg(null);
    const r = await apiPost<{ contrat?: ContratServeur }>(API.contrats, {
      action: "creer", compteId: cible.id, objet,
      montant: Number(montant.replace(",", ".")), dureeMois: Number(duree), tauxAnnuel: Number(taux.replace(",", ".")),
      mentions, demandeId: demandeId || undefined,
    });
    if (r.ok && r.corps.contrat) {
      setContrats((prev) => [...prev, r.corps.contrat!]);
      setObjet(""); setMontant(""); setDuree(""); setTaux(""); setDemandeId(""); setMentions([]);
      setMsg("ok");
    } else setMsg("err");
  };
  const mettreAJour = async () => {
    if (!contratOuvert) return;
    setMsg(null);
    const r = await apiPost<{ contrat?: ContratServeur }>(API.contrats, {
      action: "maj", contratId: contratOuvert.id, objet,
      montant: Number(montant.replace(",", ".")), dureeMois: Number(duree), tauxAnnuel: Number(taux.replace(",", ".")),
      mentions,
    });
    if (r.ok && r.corps.contrat) {
      const neuf = r.corps.contrat;
      setContrats((prev) => prev.map((c) => (c.id === neuf.id ? neuf : c)));
      setMsg("ok");
    } else setMsg("err");
  };
  const notifier = async () => {
    if (!contratOuvert) return;
    setMsgNotif(null);
    const r = await apiPost<{ contrat?: ContratServeur }>(API.contrats, { action: "notifier", contratId: contratOuvert.id });
    if (r.ok && r.corps.contrat) {
      const neuf = r.corps.contrat;
      setContrats((prev) => prev.map((c) => (c.id === neuf.id ? neuf : c)));
      setMsgNotif("ok");
    } else setMsgNotif("err");
  };
  /** Charger le contrat ouvert dans le formulaire de mise à jour. */
  const editer = (c: ContratServeur) => {
    setOuvert(c.id);
    setObjet(c.objet); setMontant(String(c.montant)); setDuree(String(c.dureeMois)); setTaux(String(c.tauxAnnuel));
    setMentions([...c.mentions]); setDemandeId(c.demandeId ?? "");
    setMsg(null); setMsgNotif(null);
  };

  /** Document HTML autonome : l'aperçu tel qu'il est téléchargé. */
  const telecharger = (c: ContratServeur) => {
    const nomClient = cible?.nom ?? c.email;
    // Les mentions sont rendues AVANT le gabarit : une liste de chaînes simples, jamais de
    // balise imbriquée dans une interpolation (le garde d'imbrication DOM ne s'y trompe pas).
    const mentionLignes = c.mentions.length > 0 ? c.mentions.map((m) => esc(tSiCle(locale, m))) : ["—"];
    const mentionHtml = mentionLignes
      .map((texte) => "<" + "li>" + texte + "<" + "/li>")
      .join("");
    const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8">
<title>${esc(c.id)} — ${tr("dashboard.contracts.docTitle")}</title>
<style>body{font-family:Georgia,serif;max-width:720px;margin:40px auto;color:#10121a;line-height:1.55;padding:0 20px}
h1{font-size:22px;letter-spacing:.06em}h2{font-size:14px;text-transform:uppercase;letter-spacing:.12em;margin-top:28px}
table{width:100%;border-collapse:collapse;margin-top:10px}td{border:1px solid #d7dbe4;padding:8px 10px;font-size:14px}
td:first-child{width:38%;color:#5b6472;font-weight:bold}.mentions li{margin:6px 0}
.sign{display:flex;gap:80px;margin-top:48px}.sign div{flex:1;border-top:1px solid #10121a;padding-top:8px;font-size:13px}
footer{margin-top:40px;font-size:11px;color:#5b6472}</style></head><body>
<h1>KREDIT — ${esc(tr("dashboard.contracts.docTitle"))}</h1>
<p>${esc(tr("dashboard.contracts.docIntro"))} · ${esc(c.id)}</p>
<h2>${esc(tr("dashboard.contracts.docObjet"))}</h2><p>${esc(tSiCle(locale, c.objet))}</p>
<h2>${esc(tr("dashboard.contracts.docIntro"))}</h2>
<table>
<tr><td>${esc(tr("dashboard.contracts.docAmount"))}</td><td>${esc(formatEUR2(c.montant, locale))}</td></tr>
<tr><td>${esc(tr("dashboard.contracts.docDuration"))}</td><td>${esc(tr("dashboard.contracts.docMonths", { n: c.dureeMois }))}</td></tr>
<tr><td>${esc(tr("dashboard.contracts.docRate"))}</td><td>${esc(formatNumber(c.tauxAnnuel, locale, { maximumFractionDigits: 2 }))} %</td></tr>
<tr><td>${esc(tr("dashboard.contracts.docMonthly"))}</td><td>${esc(formatEUR2(c.mensualite, locale))}</td></tr>
<tr><td>${esc(tr("dashboard.contracts.docDate"))}</td><td>${esc(formatDate(c.majA, locale))}</td></tr>
</table>
<h2>${esc(tr("dashboard.contracts.docMentions"))}</h2>
<ul class="mentions">${mentionHtml}</ul>
<h2>${esc(tr("dashboard.contracts.docSignatures"))}</h2>
<div class="sign"><div>${esc(tr("dashboard.contracts.docClient"))}<br>${esc(nomClient)}</div><div>${esc(tr("dashboard.contracts.docKredit"))}</div></div>
<footer>${esc(tr("dashboard.contracts.docFooter"))}</footer></body></html>`;
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${c.id}.html`;
    document.body.appendChild(a); a.click(); a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  if (!pret) return null;
  const champ = "h-11 rounded-xl border border-slate-200 px-4 text-sm bg-white text-ink focus:outline-none focus:ring-2 focus:ring-primary/30";

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-[24px] shadow-card border p-6">
        <h3 className="font-display font-extrabold text-ink flex items-center gap-2">
          <FileSignature className="w-5 h-5 text-primary" aria-hidden="true" /> {tr("dashboard.contracts.title")}
        </h3>
        <p className="mt-1 text-[12px] text-slate-400">{tr("dashboard.contracts.intro")}</p>
        <label className="mt-4 block max-w-md">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{tr("dashboard.contracts.selectClient")}</span>
          <select value={choisi ?? ""} onChange={(e) => setChoisi(e.target.value)} className={cn(champ, "mt-1 w-full")}>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.nom} — {c.email}</option>)}
          </select>
        </label>
      </div>

      {/* ——— Contrat ouvert : aperçu + mise à jour + téléchargement + notification ——— */}
      {contratOuvert && cible && (
        <div className="bg-white rounded-[24px] shadow-card border p-6">
          <div className="flex flex-wrap items-center gap-3">
            <h4 className="font-display font-extrabold text-ink">{tr("dashboard.contracts.previewTitle")} · <span className="font-mono">{contratOuvert.id}</span></h4>
            <span className={cn("text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-1 rounded-full",
              contratOuvert.statut === "NOTIFIE" ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600")}>
              {tr(contractStatutCle(contratOuvert.statut))}
            </span>
            <span className="ml-auto flex flex-wrap gap-2">
              <button type="button" onClick={() => telecharger(contratOuvert)} className={buttonClasses("outline-light", "sm")}>
                <Download className="w-4 h-4" aria-hidden="true" /> <span className="ml-2">{tr("dashboard.contracts.download")}</span>
              </button>
              <button type="button" onClick={() => void notifier()} className={buttonClasses("primary", "sm")}>
                <Send className="w-4 h-4" aria-hidden="true" /> <span className="ml-2">{tr("dashboard.contracts.notifyCta")}</span>
              </button>
            </span>
          </div>
          {/* Le document tel qu'il sera téléchargé. */}
          <div className="mt-4 rounded-2xl border bg-surface p-5 text-[13px] leading-6">
            <div className="font-display font-extrabold text-[16px] tracking-wide">KREDIT — {tr("dashboard.contracts.docTitle")}</div>
            <div className="mt-1 text-[12px] text-slate-400">{tr("dashboard.contracts.docIntro")} · <span className="font-mono">{contratOuvert.id}</span></div>
            <div className="mt-3 grid sm:grid-cols-2 gap-2">
              <div className="rounded-xl bg-white border p-3"><span className="text-slate-400 font-bold text-[11px] uppercase tracking-wider block">{tr("dashboard.contracts.docAmount")}</span><span className="font-extrabold tabular-nums">{formatEUR2(contratOuvert.montant, locale)}</span></div>
              <div className="rounded-xl bg-white border p-3"><span className="text-slate-400 font-bold text-[11px] uppercase tracking-wider block">{tr("dashboard.contracts.docDuration")}</span><span className="font-extrabold tabular-nums">{tr("dashboard.contracts.docMonths", { n: contratOuvert.dureeMois })}</span></div>
              <div className="rounded-xl bg-white border p-3"><span className="text-slate-400 font-bold text-[11px] uppercase tracking-wider block">{tr("dashboard.contracts.docRate")}</span><span className="font-extrabold tabular-nums">{formatNumber(contratOuvert.tauxAnnuel, locale, { maximumFractionDigits: 2 })} %</span></div>
              <div className="rounded-xl bg-white border p-3"><span className="text-slate-400 font-bold text-[11px] uppercase tracking-wider block">{tr("dashboard.contracts.docMonthly")}</span><span className="font-extrabold tabular-nums">{formatEUR2(contratOuvert.mensualite, locale)}</span></div>
            </div>
            <div className="mt-3"><span className="text-slate-400 font-bold text-[11px] uppercase tracking-wider block">{tr("dashboard.contracts.docObjet")}</span>{tSiCle(locale, contratOuvert.objet)}</div>
            {contratOuvert.mentions.length > 0 && (
              <ul className="mt-3 list-disc pl-5 space-y-1">
                {contratOuvert.mentions.map((m, i) => <li key={i}>{tSiCle(locale, m)}</li>)}
              </ul>
            )}
            <div className="mt-3 text-[11px] text-slate-400 tabular-nums">
              {tr("dashboard.contracts.updatedAt")} : {formatDateTime(contratOuvert.majA, locale)}
              {contratOuvert.notifieA && <> · {tr("dashboard.contracts.notifiedAt")} : {formatDateTime(contratOuvert.notifieA, locale)}</>}
            </div>
          </div>
          {msgNotif === "ok" && <p role="status" className="mt-3 text-[12px] font-bold text-emerald-600">{tr("dashboard.contracts.notifyOk")}</p>}
          {msgNotif === "err" && <p role="alert" className="mt-3 text-[12px] font-bold text-red-600">{tr("dashboard.contracts.notifyErr")}</p>}
        </div>
      )}

      {/* ——— Formulaire : création OU mise à jour du contrat ouvert ——— */}
      <div className="bg-white rounded-[24px] shadow-card border p-6">
        <h4 className="font-display font-extrabold text-ink">{contratOuvert ? tr("dashboard.contracts.update") : tr("dashboard.contracts.new")}</h4>
        <div className="mt-4 grid sm:grid-cols-2 gap-3">
          <label className="sm:col-span-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{tr("dashboard.contracts.form.objet")}</span>
            <input value={objet} onChange={(e) => setObjet(e.target.value)} placeholder={tr("dashboard.contracts.objetPlaceholder")} className={cn(champ, "mt-1 w-full")} />
          </label>
          <label>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{tr("dashboard.contracts.form.montant")}</span>
            <input value={montant} onChange={(e) => setMontant(e.target.value)} inputMode="decimal" className={cn(champ, "mt-1 w-full tabular-nums")} />
          </label>
          <label>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{tr("dashboard.contracts.form.duree")}</span>
            <input value={duree} onChange={(e) => setDuree(e.target.value)} inputMode="numeric" className={cn(champ, "mt-1 w-full tabular-nums")} />
          </label>
          <label>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{tr("dashboard.contracts.form.taux")}</span>
            <input value={taux} onChange={(e) => setTaux(e.target.value)} inputMode="decimal" className={cn(champ, "mt-1 w-full tabular-nums")} />
          </label>
          {!contratOuvert && (
            <label>
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{tr("dashboard.ech.demande")}</span>
              <select value={demandeId} onChange={(e) => setDemandeId(e.target.value)} className={cn(champ, "mt-1 w-full")}>
                <option value="">—</option>
                {demandes.map((d) => <option key={d.id} value={d.id}>{d.id}</option>)}
              </select>
            </label>
          )}
        </div>
        <div className="mt-3 rounded-xl bg-surface border p-3 text-[12px] font-bold text-slate-500">
          {tr("dashboard.contracts.mensualiteLabel")} : <span className="text-ink tabular-nums">{formatEUR2(mensAffichee, locale)}</span>
        </div>

        {/* Mentions : liste vivante, ajout borné. */}
        <div className="mt-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{tr("dashboard.contracts.mentionsTitle")}</div>
          {mentions.length > 0 && (
            <ul className="mt-2 space-y-2">
              {mentions.map((m, i) => (
                <li key={i} className="flex items-center gap-2 rounded-xl border bg-surface px-3 py-2 text-[13px]">
                  <span className="min-w-0 flex-1">{m}</span>
                  <button type="button" aria-label={tr("dashboard.contracts.addMention")} onClick={() => setMentions(mentions.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-500">
                    <X className="w-4 h-4" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex gap-2">
            <input value={mention} onChange={(e) => setMention(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") ajouterMention(); }}
              placeholder={tr("dashboard.contracts.mentionPlaceholder")} className={cn(champ, "flex-1")} />
            <button type="button" onClick={ajouterMention} className={buttonClasses("outline-light", "md")}>
              <Plus className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {contratOuvert ? (
            <button type="button" onClick={() => void mettreAJour()} className={buttonClasses("primary", "md")}>{tr("dashboard.contracts.update")}</button>
          ) : (
            <button type="button" onClick={() => void creer()} className={buttonClasses("primary", "md")}>{tr("dashboard.contracts.create")}</button>
          )}
          {msg === "ok" && <p role="status" className="text-[12px] font-bold text-emerald-600">{tr(contratOuvert ? "dashboard.contracts.updateOk" : "dashboard.contracts.createOk")}</p>}
          {msg === "err" && <p role="alert" className="text-[12px] font-bold text-red-600">{tr("dashboard.contracts.formErr")}</p>}
        </div>
      </div>

      {/* ——— Liste des contrats du client choisi ——— */}
      <div className="bg-white rounded-[24px] shadow-card border p-6">
        <h4 className="font-display font-extrabold text-ink">{tr("dashboard.contracts.title")}</h4>
        {contrats.length === 0 ? (
          <p className="mt-3 text-[13px] text-slate-500">{tr("dashboard.contracts.empty")}</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {[...contrats].sort((a, b) => b.majA.localeCompare(a.majA)).map((c) => (
              <li key={c.id} className="rounded-2xl border p-4 flex flex-wrap items-center gap-3">
                <div className="min-w-0">
                  <div className="text-[13px] font-extrabold text-ink"><span className="font-mono">{c.id}</span> · {tSiCle(locale, c.objet)}</div>
                  <div className="text-[11px] text-slate-400 tabular-nums">
                    {formatEUR2(c.montant, locale)} · {tr("dashboard.contracts.docMonths", { n: c.dureeMois })} · {formatNumber(c.tauxAnnuel, locale, { maximumFractionDigits: 2 })} % · {formatEUR2(c.mensualite, locale)}/m
                    {c.demandeId && <> · {c.demandeId}</>}
                  </div>
                </div>
                <span className={cn("text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-1 rounded-full",
                  c.statut === "NOTIFIE" ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600")}>
                  {tr(contractStatutCle(c.statut))}
                </span>
                <span className="ml-auto flex gap-2">
                  <button type="button" onClick={() => editer(c)} className={buttonClasses("outline-light", "sm")}>
                    <FileText className="w-4 h-4" aria-hidden="true" /> <span className="ml-2">{tr("dashboard.contracts.previewTitle")}</span>
                  </button>
                  <button type="button" onClick={() => telecharger(c)} className={buttonClasses("outline-light", "sm")}>
                    <Download className="w-4 h-4" aria-hidden="true" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Clé i18n du statut d'un contrat — jamais de texte en dur. */
function contractStatutCle(statut: ContratServeur["statut"]): string {
  return statut === "NOTIFIE" ? "dashboard.contracts.status.NOTIFIE" : "dashboard.contracts.status.BROUILLON";
}
