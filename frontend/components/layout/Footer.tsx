"use client";
import Link from "next/link";
import { Locale, locales, gdprAcronym, localeLabels, t } from "@/lib/i18n";
import { ShieldCheck, Lock, FileText, Globe, MapPin, Clock, Mail, MessageCircle, ArrowUpRight } from "lucide-react";

/**
 * Pied de page — slice 1 (+ menu Contact).
 *
 * Deux règles vécues commandent ce fichier:
 * 1. chaque lien mène quelque part qui existe (pas de `href="#"` décoratif: c'est un écran mort,
 *    donc pire qu'un écran absent);
 * 2. aucune donnée inventée: l'adresse, les horaires et les canaux affichés sont les coordonnées
 *    de démonstration des dictionnaires (`contact.*`, slice 1) — la colonne Contact pointe vers
 *    la section réelle du formulaire (`#contact` sur l'accueil), qui écrit dans le magasin via
 *    /api/contact.
 *
 * L'année de copyright vient de `common:footer.rights` (chaîne statique des dictionnaires,
 * identique serveur/client — jamais de `new Date()` au render, cf. docs/hydration.md règle 4).
 */
export default function Footer({ locale }: { locale: Locale }) {
  const tr = (k: string) => t(locale, k);
  return (
    <footer className="bg-ink text-white/80">
      <div className="mx-auto max-w-[1280px] px-6 py-14">
        <div className="grid md:grid-cols-2 lg:grid-cols-6 gap-10">
          <div className="lg:col-span-2">
            <div className="flex items-center gap-2 mb-4"><div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center font-extrabold text-white">K</div><span className="font-display font-extrabold text-white text-lg">KREDIT.</span></div>
            <p className="text-sm leading-6 text-white/60">{tr("footer.tagline")}</p>
            <div className="flex flex-wrap gap-2 mt-4">
              {/* Sigles réglementaires: ils n'ont pas de forme traduite (le règlement s'appelle
                  eIDAS en français, en néerlandais et en anglais), et la ligne est la même sur
                  les quatre marchés. */}
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 border border-white/10 text-xs"><ShieldCheck className="w-3.5 h-3.5" /> FSMA</span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 border border-white/10 text-xs"><Lock className="w-3.5 h-3.5" /> {gdprAcronym[locale]}</span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 border border-white/10 text-xs"><FileText className="w-3.5 h-3.5" /> eIDAS</span>
            </div>
          </div>

          <div>
            <h4 className="text-white font-bold text-sm mb-4">{tr("footer.products")}</h4>
            <ul className="space-y-2 text-sm text-white/60">
              {/* Les liens reprennent les noms de produits DES DICTIONNAIRES: « Crédit Personnel »
                  capitalisé en dur dans le JSX était une cinquième orthographe du produit,
                  différente de `products.personal` utilisée partout ailleurs. La slice 1 n'a qu'une
                  page: ils mènent à la section produits de l'accueil — une destination réelle. */}
              <li><Link href={`/${locale}#produits`} className="hover:text-white">{tr("products.personal")}</Link></li>
              <li><Link href={`/${locale}#produits`} className="hover:text-white">{tr("products.mortgage")}</Link></li>
              <li><Link href={`/${locale}#produits`} className="hover:text-white">{tr("products.business")}</Link></li>
              <li><Link href={`/${locale}#produits`} className="hover:text-white">{tr("products.invest")}</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="text-white font-bold text-sm mb-4">{tr("footer.compliance")}</h4>
            <ul className="space-y-2 text-sm text-white/60">
              <li>{tr("footer.kyc")}</li>
              <li>{tr("footer.secci")}</li>
              <li>{tr("footer.audit")}</li>
              <li>{tr("footer.legalValidation")} <span className="text-amber-400">{tr("footer.required")}</span></li>
            </ul>
          </div>

          {/* Menu Contact : les coordonnées des dictionnaires + le lien vers le formulaire réel
              (section #contact de l'accueil). C'est par là qu'un visiteur écrit à l'équipe —
              le message part dans le magasin via /api/contact. */}
          <div>
            <h4 className="text-white font-bold text-sm mb-4">{tr("nav.contact")}</h4>
            <ul className="space-y-2.5 text-sm text-white/60">
              <li className="flex gap-2"><MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" aria-hidden="true" /> {tr("contact.address")}</li>
              <li className="flex gap-2"><Clock className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" aria-hidden="true" /> {tr("contact.hours")}</li>
              <li className="flex gap-2"><Mail className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" aria-hidden="true" /> {tr("contact.emailNote")}</li>
              <li className="flex gap-2"><MessageCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" aria-hidden="true" /> {tr("contact.whatsappNote")}</li>
            </ul>
            <Link href={`/${locale}#contact`} className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-bold text-primary hover:text-primary-hover transition">
              {tr("contact.submit")} <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
            </Link>
          </div>

          <div>
            {/* `shell.notFoundOther` = « Choisir une autre langue » dans les quatre langues:
                c'est très exactement l'objet de cette colonne, et la clé existe déjà. */}
            <h4 className="text-white font-bold text-sm mb-4">{tr("shell.notFoundOther")}</h4>
            <ul className="space-y-2 text-sm text-white/60">
              {locales.map((l) => (
                <li key={l}>
                  <Link href={`/${l}`} aria-current={l === locale ? "page" : undefined} className={l === locale ? "text-white font-bold" : "hover:text-white"}>
                    {localeLabels[l]}
                  </Link>
                </li>
              ))}
            </ul>
            {/* Énumération des marchés servis: des codes, pas de la copie (identique partout). */}
            <p className="text-xs text-white/40 mt-3 flex items-center gap-1"><Globe className="w-3 h-3" /> FR • EN • NL • DE • EUR</p>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-white/10">
          <p className="text-[11px] leading-5 text-white/45">⚠️ {tr("footer.disclaimer")}</p>
          <p className="text-[11px] text-white/30 mt-3">{tr("footer.rights")}</p>
        </div>
      </div>
    </footer>
  );
}
