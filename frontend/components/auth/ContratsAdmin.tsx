"use client";
/**
 * Slice 23 — Gestion des contrats des clients (réservé ADMIN / SUPER_ADMIN).
 *
 * Remplace le menu « Mes demandes » de l'administration : on établit pour un client un
 * « LOAN AGREEMENT » (modèle intégré), dont l'EMPRUNTEUR est recomposé automatiquement depuis le
 * profil du client, dont le CONTENU (corps, prêteur, référence) est éditable, et dont l'ENTÊTE
 * porte un logo téléversable (défaut : `/logos/tei.png`). Le document s'aperçoit en direct
 * (iframe), se télécharge (HTML autonome) et se notifie au client (site + e-mail + WhatsApp).
 * Les données du crédit figurent en ANNEXE (montant, taux, échéancier complet).
 * La mensualité est TOUJOURS calculée par le serveur (annuité constante, lib/contrat-doc).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Download, FileSignature, FileText, Plus, RotateCcw, Send, Upload, X } from "lucide-react";
import { buttonClasses } from "@/components/ui/Button";
import { formatEUR2, cn } from "@/lib/utils";
import { formatDateTime, formatNumber } from "@/lib/formatters";
import { Locale, t, tSiCle } from "@/lib/i18n";
import { API, apiGet, apiPost } from "@/lib/api";
import {
  CONTRAT_LOGO_MAX, PRETEUR_DEFAUT, corpsDefautDe, emprunteurDe, mensualiteContrat,
  rendreHtmlContrat, type ArgsDocumentContrat, type LangueContrat,
} from "@/lib/contrat-doc";
import type { ContratServeur } from "@/lib/serveur";

interface ClientOps { id: string; email: string; nom: string; profil?: Record<string, string> | null }
interface DemandeApercu { id: string; email: string }

/** Logo par défaut de l'entête (pièce jointe intégrée au dépôt). */
const LOGO_DEFAUT = "/logos/tei.png";

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
  const [logoErr, setLogoErr] = useState(false);
  const [horodatage, setHorodatage] = useState("");
  const logoCache = useRef<string | null>(null);

  // Formulaire (création ou mise à jour) — contenu du document inclus.
  const [objet, setObjet] = useState("");
  const [montant, setMontant] = useState("");
  const [duree, setDuree] = useState("");
  const [taux, setTaux] = useState("");
  const [demandeId, setDemandeId] = useState("");
  const [reference, setReference] = useState("");
  const [preteur, setPreteur] = useState(PRETEUR_DEFAUT);
  const [langue, setLangue] = useState<LangueContrat>("EN");
  const [corps, setCorps] = useState(() => corpsDefautDe("EN"));
  const [logo, setLogo] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [mention, setMention] = useState("");

  const cible = clients.find((c) => c.id === choisi) ?? null;
  const contratOuvert = contrats.find((c) => c.id === ouvert) ?? null;

  const num = (s: string) => Number(s.replace(",", "."));
  const mensAffichee = useMemo(
    () => mensualiteContrat(num(montant), Number(duree), num(taux)),
    [montant, duree, taux],
  );

  const chargerContrats = async (idCompte: string) => {
    const r = await apiGet<{ contrats: ContratServeur[] }>(`${API.contrats}?compte=${encodeURIComponent(idCompte)}`);
    setContrats(r.ok ? r.corps.contrats : []);
  };
  const chargerDemandes = async (email: string) => {
    const r = await apiGet<{ demandes: DemandeApercu[] }>(`${API.demandes}?compte=${encodeURIComponent(email)}`);
    setDemandes(r.ok ? r.corps.demandes : []);
  };

  useEffect(() => {
    // Horodatage du brouillon pris UNE fois côté client (jamais au render : garde d'hydratation).
    setHorodatage(new Date().toISOString());
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
    void chargerDemandes(choisi.split("::")[0]);
    setOuvert(null);
    resetFormulaire();
  }, [choisi]);

  const resetFormulaire = () => {
    setObjet(""); setMontant(""); setDuree(""); setTaux(""); setDemandeId("");
    setReference(""); setPreteur(PRETEUR_DEFAUT); setLangue("EN"); setCorps(corpsDefautDe("EN")); setLogo("");
    setMentions([]); setMention(""); setMsg(null); setMsgNotif(null); setLogoErr(false);
  };

  /** Change la langue du document ; si le corps n'est pas personnalisé, il suit le modèle de la langue. */
  const changerLangue = (l: LangueContrat) => {
    setCorps((prev) => (prev === corpsDefautDe(langue) ? corpsDefautDe(l) : prev));
    setLangue(l);
  };

  /** Emprunteur recomposé automatiquement depuis le profil du client sélectionné. */
  const emprunteur = useMemo(
    () => (cible ? emprunteurDe(cible.nom, cible.email, cible.profil) : null),
    [cible],
  );

  /** Document construit depuis le FORMULAIRE (aperçu en direct pendant la saisie). */
  const docFormulaire = useMemo<ArgsDocumentContrat | null>(() => {
    if (!cible || !emprunteur) return null;
    const m = num(montant) || 0;
    const n = Number(duree) || 0;
    const tx = num(taux) || 0;
    return {
      contrat: {
        id: contratOuvert?.id ?? "—", reference: reference.trim() || contratOuvert?.reference || "",
        montant: m, dureeMois: n, tauxAnnuel: tx,
        mensualite: mensualiteContrat(m, n, tx),
        objet: objet.trim() || "—", creeA: contratOuvert?.creeA ?? horodatage, majA: contratOuvert?.majA ?? horodatage,
      },
      emprunteur, preteur, corps, logoSrc: logo || LOGO_DEFAUT,
      mentions: mentions.map((x) => tSiCle(locale, x)), langue,
    };
  }, [cible, emprunteur, montant, duree, taux, objet, reference, preteur, corps, logo, mentions, contratOuvert, locale, horodatage, langue]);

  const apercuHtml = useMemo(() => (docFormulaire ? rendreHtmlContrat(docFormulaire) : ""), [docFormulaire]);

  const ajouterMention = () => {
    const m = mention.trim();
    if (!m || mentions.length >= 12) return;
    setMentions([...mentions, m.slice(0, 300)]);
    setMention("");
  };

  const surLogo = (f: File | null) => {
    setLogoErr(false);
    if (!f) return;
    if (!f.type.startsWith("image/") || f.size > 600_000) { setLogoErr(true); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const url = typeof reader.result === "string" ? reader.result : "";
      if (!url || url.length > CONTRAT_LOGO_MAX) { setLogoErr(true); return; }
      setLogo(url);
    };
    reader.readAsDataURL(f);
  };

  const payloadContenu = () => ({
    reference: reference.trim() || undefined,
    preteur: preteur.trim() === PRETEUR_DEFAUT.trim() ? undefined : preteur,
    corps: corps.trim() === corpsDefautDe(langue).trim() ? undefined : corps,
    logo: logo || undefined,
    langue,
  });

  const creer = async () => {
    if (!cible) return;
    setMsg(null);
    const r = await apiPost<{ contrat?: ContratServeur }>(API.contrats, {
      action: "creer", compteId: cible.id, objet,
      montant: num(montant), dureeMois: Number(duree), tauxAnnuel: num(taux),
      mentions, demandeId: demandeId || undefined, ...payloadContenu(),
    });
    if (r.ok && r.corps.contrat) {
      setContrats((prev) => [...prev, r.corps.contrat!]);
      resetFormulaire();
      setMsg("ok");
    } else setMsg("err");
  };

  const mettreAJour = async () => {
    if (!contratOuvert) return;
    setMsg(null);
    const r = await apiPost<{ contrat?: ContratServeur }>(API.contrats, {
      action: "maj", contratId: contratOuvert.id, objet,
      montant: num(montant), dureeMois: Number(duree), tauxAnnuel: num(taux),
      mentions, ...payloadContenu(),
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

  const editer = (c: ContratServeur) => {
    setOuvert(c.id);
    setObjet(c.objet); setMontant(String(c.montant)); setDuree(String(c.dureeMois)); setTaux(String(c.tauxAnnuel));
    setMentions([...c.mentions]); setDemandeId(c.demandeId ?? "");
    setReference(c.reference ?? ""); setPreteur(c.preteur ?? PRETEUR_DEFAUT);
    setLangue(c.langue ?? "EN"); setCorps(c.corps ?? corpsDefautDe(c.langue ?? "EN")); setLogo(c.logo ?? "");
    setMsg(null); setMsgNotif(null); setLogoErr(false);
  };

  /** Résout le logo en dataURL (embarqué dans le fichier autonome). */
  const logoDataUrl = async (champ: string | undefined): Promise<string | null> => {
    if (champ) return champ;
    if (logoCache.current) return logoCache.current;
    try {
      const r = await fetch(LOGO_DEFAUT);
      const blob = await r.blob();
      return await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          const url = typeof reader.result === "string" ? reader.result : null;
          logoCache.current = url;
          resolve(url);
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch { return null; }
  };

  /** Télécharge le contrat tel qu'aperçu (document HTML autonome, logo embarqué). */
  const telecharger = async (c: ContratServeur) => {
    const em = emprunteurDe(cible?.nom ?? c.email, c.email, cible?.profil);
    const doc: ArgsDocumentContrat = {
      contrat: c, emprunteur: em, preteur: c.preteur ?? PRETEUR_DEFAUT, corps: c.corps ?? corpsDefautDe(c.langue ?? "EN"),
      logoSrc: await logoDataUrl(c.logo), mentions: c.mentions.map((x) => tSiCle(locale, x)), langue: c.langue ?? "EN",
    };
    const blob = new Blob([rendreHtmlContrat(doc)], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${c.reference || c.id}.html`;
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
        {emprunteur && (
          <p className="mt-3 text-[12px] text-slate-500">
            <span className="font-bold uppercase tracking-wider text-[11px]">{tr("dashboard.contracts.borrower")} : </span>
            {emprunteur.nom} · {emprunteur.email}{emprunteur.telephone ? ` · ${emprunteur.telephone}` : ""}{emprunteur.adresse ? ` · ${emprunteur.adresse}` : ""}
          </p>
        )}
      </div>

      {/* ——— Aperçu du document en direct (iframe isolée = rendu exact du téléchargement) ——— */}
      {docFormulaire && (
        <div className="bg-white rounded-[24px] shadow-card border p-6">
          <div className="flex flex-wrap items-center gap-3">
            <h4 className="font-display font-extrabold text-ink">{tr("dashboard.contracts.previewDoc")}</h4>
            {contratOuvert && (
              <span className={cn("text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-1 rounded-full",
                contratOuvert.statut === "NOTIFIE" ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600")}>
                {tr(contractStatutCle(contratOuvert.statut))}
              </span>
            )}
            <span className="ml-auto flex flex-wrap gap-2">
              {contratOuvert && (
                <>
                  <button type="button" onClick={() => void telecharger(contratOuvert)} className={buttonClasses("outline-light", "sm")}>
                    <Download className="w-4 h-4" aria-hidden="true" /> <span className="ml-2">{tr("dashboard.contracts.download")}</span>
                  </button>
                  <button type="button" onClick={() => void notifier()} className={buttonClasses("primary", "sm")}>
                    <Send className="w-4 h-4" aria-hidden="true" /> <span className="ml-2">{tr("dashboard.contracts.notifyCta")}</span>
                  </button>
                </>
              )}
            </span>
          </div>
          <iframe title={tr("dashboard.contracts.previewDoc")} srcDoc={apercuHtml} className="mt-4 w-full h-[560px] rounded-2xl border bg-white" />
          {contratOuvert && (
            <div className="mt-3 text-[11px] text-slate-400 tabular-nums">
              {tr("dashboard.contracts.updatedAt")} : {formatDateTime(contratOuvert.majA, locale)}
              {contratOuvert.notifieA && <> · {tr("dashboard.contracts.notifiedAt")} : {formatDateTime(contratOuvert.notifieA, locale)}</>}
            </div>
          )}
          {msgNotif === "ok" && <p role="status" className="mt-3 text-[12px] font-bold text-emerald-600">{tr("dashboard.contracts.notifyOk")}</p>}
          {msgNotif === "err" && <p role="alert" className="mt-3 text-[12px] font-bold text-red-600">{tr("dashboard.contracts.notifyErr")}</p>}
        </div>
      )}

      {/* ——— Formulaire : création OU mise à jour, contenu du document éditable ——— */}
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
          <label>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{tr("dashboard.contracts.reference")}</span>
            <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder={tr("dashboard.contracts.referenceAuto")} className={cn(champ, "mt-1 w-full font-mono")} />
          </label>
          <label>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{tr("dashboard.contracts.langue")}</span>
            <select value={langue} onChange={(e) => changerLangue(e.target.value === "FR" ? "FR" : "EN")} className={cn(champ, "mt-1 w-full")}>
              <option value="EN">{tr("dashboard.contracts.langueEN")}</option>
              <option value="FR">{tr("dashboard.contracts.langueFR")}</option>
            </select>
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

        {/* Entête : logo + bloc prêteur + corps éditable. */}
        <div className="mt-4 grid sm:grid-cols-2 gap-3">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{tr("dashboard.contracts.logo")}</span>
            <div className="mt-1 flex items-center gap-2">
              <img src={logo || LOGO_DEFAUT} alt="" className="h-12 w-12 rounded-lg border object-contain bg-white" />
              <label className={buttonClasses("outline-light", "sm")}>
                <Upload className="w-4 h-4" aria-hidden="true" /> <span className="ml-2">{tr("dashboard.contracts.logoUpload")}</span>
                <input type="file" accept="image/*" className="sr-only" onChange={(e) => surLogo(e.target.files?.[0] ?? null)} />
              </label>
              {logo && (
                <button type="button" onClick={() => setLogo("")} className={buttonClasses("outline-light", "sm")}>
                  <RotateCcw className="w-4 h-4" aria-hidden="true" /> <span className="ml-2">{tr("dashboard.contracts.logoDefault")}</span>
                </button>
              )}
            </div>
            {logoErr && <p role="alert" className="mt-1 text-[11px] font-bold text-red-600">{tr("dashboard.contracts.logoTooBig")}</p>}
          </div>
          <label>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{tr("dashboard.contracts.lender")}</span>
            <textarea value={preteur} onChange={(e) => setPreteur(e.target.value)} rows={5} className={cn(champ, "mt-1 w-full h-auto py-2 text-[12px] leading-5")} />
          </label>
        </div>
        <label className="mt-3 block">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{tr("dashboard.contracts.corps")}</span>
          <textarea value={corps} onChange={(e) => setCorps(e.target.value)} rows={12} className={cn(champ, "mt-1 w-full h-auto py-2 font-mono text-[11px] leading-5")} />
        </label>
        <button type="button" onClick={() => setCorps(corpsDefautDe(langue))} className={cn(buttonClasses("outline-light", "sm"), "mt-2")}>
          <RotateCcw className="w-4 h-4" aria-hidden="true" /> <span className="ml-2">{tr("dashboard.contracts.resetCorps")}</span>
        </button>

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
                  <div className="text-[13px] font-extrabold text-ink"><span className="font-mono">{c.reference || c.id}</span> · {tSiCle(locale, c.objet)}</div>
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
                  <button type="button" onClick={() => void telecharger(c)} className={buttonClasses("outline-light", "sm")}>
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
