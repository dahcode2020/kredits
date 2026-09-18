"use client";
/**
 * Menu Contact — la section « écrire à l'équipe » du bas de page d'accueil.
 *
 * Les clés `contact.*` existaient depuis la slice 1 mais restaient non rendues : le site n'avait
 * nulle part où écrire. Cette section leur donne leur destination, avec les règles du dépôt :
 * - zéro texte en dur (tout vient des dictionnaires, parité ×4) ;
 * - le formulaire mène quelque part de RÉEL : POST /api/contact (lib/api.ts), le message est
 *   enregistré dans le magasin et l'équipe est notifiée — rien n'est simulé côté client ;
 * - sans JavaScript, le formulaire fonctionne quand même : `action` natif + réponse HTML du
 *   serveur (échappatoire n°2, cf. app/api/contact/route.ts) ;
 * - aucune promesse automatique : `contact.afterNote` le dit, la réponse est humaine ;
 * - pas de donnée sensible : `contact.noSensitive` est affiché avant l'envoi.
 */
import { useState, type FormEvent } from "react";
import { Check, Clock, Mail, MapPin, MessageCircle, Send } from "lucide-react";
import Reveal from "@/components/motion/Reveal";
import { Button } from "@/components/ui/Button";
import { API, apiPost } from "@/lib/api";
import { CLES_ERREUR_CONTACT, CONTACT_MESSAGE_MAX, CONTACT_MESSAGE_MIN, CONTACT_NOM_MAX, CONTACT_SUJET_MAX } from "@/lib/contact";
import { Locale, t } from "@/lib/i18n";

type Erreur = string | null;

export default function ContactSection({ locale }: { locale: Locale }) {
  const tr = (k: string, vars?: Record<string, string | number>) => t(locale, k, vars);
  const [nom, setNom] = useState("");
  const [email, setEmail] = useState("");
  const [sujet, setSujet] = useState("");
  const [message, setMessage] = useState("");
  const [consentement, setConsentement] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [reference, setReference] = useState<string | null>(null);
  const [erreur, setErreur] = useState<Erreur>(null);

  async function envoyer(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (envoi) return;
    setEnvoi(true);
    setErreur(null);
    // POST JSON via fetch (le cas normal) ; l'action native du formulaire ne sert que sans JS.
    const r = await apiPost<{ message?: { id: string } }>(API.contact, {
      nom, email, sujet, message, consentement, locale,
    });
    setEnvoi(false);
    if (r.ok && r.corps.message) {
      setReference(r.corps.message.id);
      return;
    }
    setErreur(tr(CLES_ERREUR_CONTACT[r.corps.erreur ?? ""] ?? "contact.err.champs"));
  }

  const champClasse = "w-full h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm text-ink placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition";

  return (
    <section id="contact" className="scroll-mt-24 bg-surface py-16 md:py-24">
      <div className="mx-auto max-w-[1280px] px-6">
        <div className="grid lg:grid-cols-[1fr_1.1fr] gap-10 items-start">
          {/* ——— Coordonnées + plan ——— */}
          <div>
            <Reveal as="div" className="section-title">{tr("contact.title")}</Reveal>
            <Reveal as="h2" retard={80} className="section-heading mt-2">{tr("contact.subtitle")}</Reveal>
            {/* Le <ul> est écrit en toutes lettres (même règle que le <details> de la FAQ):
                le vérificateur d'imbrication doit VOIR la paire ul/li — un composant opaque
                (`Reveal as="ul"`) cacherait le parent des <li>. */}
            <ul className="mt-6 space-y-4 text-sm">
              <Reveal as="li" retard={150} className="flex gap-3">
                <span className="mt-0.5 w-9 h-9 rounded-xl bg-white border shadow-soft text-primary grid place-items-center shrink-0"><MapPin className="w-4 h-4" aria-hidden="true" /></span>
                <span className="text-slate-600"><span className="block font-bold text-ink">{tr("contact.hq")}</span>{tr("contact.address")}</span>
              </Reveal>
              <Reveal as="li" retard={200} className="flex gap-3">
                <span className="mt-0.5 w-9 h-9 rounded-xl bg-white border shadow-soft text-primary grid place-items-center shrink-0"><Clock className="w-4 h-4" aria-hidden="true" /></span>
                <span className="text-slate-600">{tr("contact.hours")}</span>
              </Reveal>
              <Reveal as="li" retard={250} className="flex gap-3">
                <span className="mt-0.5 w-9 h-9 rounded-xl bg-white border shadow-soft text-primary grid place-items-center shrink-0"><Mail className="w-4 h-4" aria-hidden="true" /></span>
                <span className="text-slate-600">{tr("contact.emailNote")}</span>
              </Reveal>
              <Reveal as="li" retard={300} className="flex gap-3">
                <span className="mt-0.5 w-9 h-9 rounded-xl bg-white border shadow-soft text-primary grid place-items-center shrink-0"><MessageCircle className="w-4 h-4" aria-hidden="true" /></span>
                <span className="text-slate-600">{tr("contact.whatsappNote")}</span>
              </Reveal>
            </ul>
            {/* Plan illustratif (généré, décoratif : alt vide) — la clé `contact.map` dit
                exactement ce que c'est : un placeholder sans tracker par défaut. */}
            <Reveal as="div" retard={220} variant="right" pas={24} className="relative mt-6 h-[220px] rounded-[24px] overflow-hidden border shadow-card">
              <img src="/images/contact-map.jpg" alt="" aria-hidden="true" className="absolute inset-0 w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-ink/50 to-transparent" aria-hidden="true" />
              <div className="absolute left-4 bottom-4 flex items-center gap-2 rounded-full bg-ink/70 backdrop-blur border border-white/15 px-4 py-2 text-[11px] font-bold tracking-wide text-white">
                <MapPin className="w-3.5 h-3.5 text-primary" aria-hidden="true" /> {tr("contact.map")}
              </div>
            </Reveal>
          </div>

          {/* ——— Formulaire ——— */}
          <Reveal as="div" retard={120} variant="left" className="bg-white rounded-[24px] border shadow-soft p-6 md:p-8">
            {reference ? (
              <div className="text-center py-8">
                <span className="mx-auto w-14 h-14 rounded-full bg-emerald-50 text-emerald-600 grid place-items-center"><Check className="w-7 h-7" aria-hidden="true" /></span>
                <h3 className="mt-4 font-display font-extrabold text-ink text-xl">{tr("contact.sent")}</h3>
                <p className="mt-2 text-sm text-slate-600">{tr("contact.reference", { ref: reference })}</p>
                <p className="mt-1 text-sm text-slate-500">{tr("contact.afterNote")}</p>
              </div>
            ) : (
              /* `action` + `method` natifs : sans JavaScript, le POST part quand même et le serveur
                 répond en HTML lisible (app/api/contact/route.ts). Avec JS, preventDefault + JSON. */
              <form action={API.contact} method="post" onSubmit={envoyer} className="space-y-4" noValidate>
                <input type="hidden" name="locale" value={locale} />
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="contact-nom" className="block text-xs font-bold tracking-wider uppercase text-slate-500 mb-1.5">{tr("contact.name")}</label>
                    <input id="contact-nom" name="nom" value={nom} onChange={(e) => setNom(e.target.value)} required maxLength={CONTACT_NOM_MAX}
                      placeholder={tr("contact.namePh")} className={champClasse} autoComplete="name" />
                  </div>
                  <div>
                    <label htmlFor="contact-email" className="block text-xs font-bold tracking-wider uppercase text-slate-500 mb-1.5">{tr("contact.email")}</label>
                    <input id="contact-email" name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                      placeholder={t(locale, "auth:email.placeholder")} className={champClasse} autoComplete="email" />
                  </div>
                </div>
                <div>
                  <label htmlFor="contact-sujet" className="block text-xs font-bold tracking-wider uppercase text-slate-500 mb-1.5">{tr("contact.subject")}</label>
                  <input id="contact-sujet" name="sujet" value={sujet} onChange={(e) => setSujet(e.target.value)} required maxLength={CONTACT_SUJET_MAX}
                    placeholder={tr("contact.subjectPh")} className={champClasse} />
                </div>
                <div>
                  <label htmlFor="contact-message" className="block text-xs font-bold tracking-wider uppercase text-slate-500 mb-1.5">{tr("contact.message")}</label>
                  <textarea id="contact-message" name="message" value={message} onChange={(e) => setMessage(e.target.value)} required
                    minLength={CONTACT_MESSAGE_MIN} maxLength={CONTACT_MESSAGE_MAX} rows={5}
                    placeholder={tr("contact.messagePh")} className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-ink placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition resize-y" />
                  <p className="mt-1 text-[11px] text-slate-400">{tr("contact.noSensitive")}</p>
                </div>
                <label className="flex items-start gap-3 text-[13px] text-slate-600 cursor-pointer">
                  {/* Case JAMAIS pré-cochée : le consentement RGPD est un geste explicite. */}
                  <input type="checkbox" name="consentement" checked={consentement} onChange={(e) => setConsentement(e.target.checked)} required
                    className="mt-0.5 w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary/30" />
                  <span>{tr("contact.consent")}</span>
                </label>
                {erreur && (
                  <p role="alert" className="rounded-xl bg-red-50 border border-red-100 text-red-700 text-[13px] px-4 py-3">{erreur}</p>
                )}
                <Button type="submit" variant="primary" size="lg" className="w-full gap-2" disabled={envoi}>
                  {envoi ? "…" : tr("contact.submit")} <Send className="w-4 h-4" aria-hidden="true" />
                </Button>
              </form>
            )}
          </Reveal>
        </div>
      </div>
    </section>
  );
}
