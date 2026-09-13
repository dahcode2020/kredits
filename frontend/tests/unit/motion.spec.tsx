/**
 * Verrous de la couche de mouvement (docs/motion.md).
 *
 * Ce fichier ne teste pas « est-ce que ça bouge joliment » — l'œil jugera ça dans l'aperçu. Il teste
 * les trois propriétés qui, si elles sautent, transforment une animation en panne visible :
 *
 *  1. **Le contenu n'est jamais la variable d'ajustement d'un effet.** Le texte doit être dans le DOM
 *     avant que l'animation ne joue, et l'état caché doit rester annulable par le CSS seul
 *     (`prefers-reduced-motion`, `<noscript>`, impression). Une régression ici = page blanche pour un
 *     crawler, un bloqueur de scripts ou un visiteur qui a demandé moins de mouvement.
 *  2. **Le premier rendu client est identique au HTML servi.** `data-shown="false"`, texte final des
 *     compteurs : tout ce qui dépend de l'environnement (IO, `matchMedia`, `scrollY`) se décide en
 *     effet, jamais au render. C'est la cause d'hydratation n°1 de ce dépôt.
 *  3. **Un compteur finit sur la chaîne du serveur, pas sur une valeur recomposée.** `Intl` côté
 *     navigateur et côté serveur n'écrivent pas toujours le même espace ; revenir au texte littéral
 *     rend la différence inatteignable.
 */
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Reveal from "@/components/motion/Reveal";
import CountUp from "@/components/motion/CountUp";
import ScrollProgress from "@/components/motion/ScrollProgress";
import Parallax from "@/components/motion/Parallax";

const ROOT = join(__dirname, "..", "..");

// —————————————————————————————————— faux pilotes, installés une fois
type Entree = { isIntersecting: boolean; target: Element };
type SurObs = (entrees: Entree[], obs: { disconnect: () => void }) => void;
const observateurs = new Set<IntersectionObserverMock>();

class IntersectionObserverMock {
  sur: SurObs;
  constructor(sur: SurObs) {
    this.sur = sur;
    observateurs.add(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {
    observateurs.delete(this);
  }
}

const glob = globalThis as unknown as Record<string, unknown>;
const w = window as unknown as Record<string, unknown>;
let reduit = false;
const ecouteurs: Record<string, Set<() => void>> = {};
let rafEnAttente: ((t: number) => void)[] = [];
let rafAppels = 0;
let horloge = 0;

// L'horloge de la feinte: `useTween` prend son `t0` sur performance.now() et ses frames sur rAF.
// Sans ce patch, les deux horloges divergent (performance avance en temps reel, la mienne en bonds
// de 120 ms) et l'animation ne peut jamais atteindre p = 1 dans le test — elle parait « figee en
// cours », ce qui n'est pas le comportement du navigateur.
let espionNow: jest.SpyInstance | undefined;

function defilerRaf(jusqua = 60) {
  for (let i = 0; i < jusqua && rafEnAttente.length; i++) {
    const file = rafEnAttente;
    rafEnAttente = [];
    horloge += 120; // > durée des animations: la dernière frame tombe toujours sur la cible
    file.forEach((cb) => cb(horloge));
  }
}

beforeAll(() => {
  glob.IntersectionObserver = IntersectionObserverMock;
  // `tests/setup.ts` a déjà remplacé matchMedia par un jest.fn configurable (celui de jsdom ne
  // l'est pas): on en change seulement l'implémentation pour que `matches` suive `reduit`.
  (window.matchMedia as unknown as jest.Mock).mockImplementation((q: string) => ({
    media: q,
    matches: reduit && /reduced-motion/.test(q),
    onchange: null,
    addEventListener: (t: string, cb: () => void) => {
      (ecouteurs[t] ||= new Set()).add(cb);
    },
    removeEventListener: (t: string, cb: () => void) => ecouteurs[t]?.delete(cb),
    addListener: (cb: () => void) => (ecouteurs["change"] ||= new Set()).add(cb),
    removeListener: (cb: () => void) => ecouteurs["change"]?.delete(cb),
    dispatchEvent: () => true,
  }));
  w.requestAnimationFrame = (cb: (t: number) => void) => {
    rafAppels++;
    rafEnAttente.push(cb);
    return rafAppels;
  };
  w.cancelAnimationFrame = () => {};
  espionNow = jest.spyOn(performance, "now").mockImplementation(() => horloge);
});

afterAll(() => espionNow?.mockRestore());

beforeEach(() => {
  reduit = false;
  rafEnAttente = [];
  rafAppels = 0;
  horloge = 0;
  observateurs.clear();
});

function entrer() {
  act(() => {
    [...observateurs].forEach((o) => o.sur([{ isIntersecting: true, target: document.body }], o));
  });
}

async function monter(el: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root | undefined;
  await act(async () => {
    root = createRoot(container);
    root.render(el);
  });
  return {
    container,
    async demo() {
      await act(async () => root?.unmount());
      container.remove();
    },
  };
}

// —————————————————————————————————— 1. le contenu survit à l'animation
describe("Reveal — l'apparition ne cache rien à qui ne peut pas animer", () => {
  it("rend les enfants immédiatement, avant même que l'observateur ait parlé", async () => {
    const { container, demo } = await monter(
      <Reveal as="div" variant="up">
        <span>4 800 dossiers</span>
      </Reveal>,
    );
    expect(container.textContent).toContain("4 800 dossiers");
    expect(container.querySelector("[data-reveal]")?.getAttribute("data-shown")).toBe("false");
    await demo();
  });

  it("libère l'état quand l'élément entre dans le viewport", async () => {
    const { container, demo } = await monter(<Reveal as="h2">Titre</Reveal>);
    entrer();
    expect(container.querySelector("[data-reveal]")?.getAttribute("data-shown")).toBe("true");
    await demo();
  });

  it("sans IntersectionObserver, considère que c'est visible", async () => {
    // `delete` ne suffit pas: la classe a été posée sur globalThis en setup, et le hook lit la
    // référence à chaque effet — on la masque par une valeur undefined explicite.
    const avant = glob.IntersectionObserver;
    glob.IntersectionObserver = undefined;
    const { container, demo } = await monter(<Reveal as="div">Sans IO</Reveal>);
    expect(container.querySelector("[data-reveal]")?.getAttribute("data-shown")).toBe("true");
    glob.IntersectionObserver = avant;
    await demo();
  });

  it("ne crée pas de nœud de plus: la balise demandée porte l'attribut", async () => {
    const { container, demo } = await monter(
      <ul>
        <Reveal as="li">un</Reveal>
      </ul>,
    );
    const li = container.querySelector("li");
    expect(li?.getAttribute("data-reveal")).toBe("up");
    expect(container.querySelectorAll("div").length).toBe(0);
    await demo();
  });
});

// —————————————————————————————————— 2. les compteurs ne mentent jamais
describe("CountUp — contrat avec le HTML servi", () => {
  const final = "8 400+";

  it("au premier rendu, affiche le texte final, pas zéro", async () => {
    const { container, demo } = await monter(
      <CountUp a={8400} final={final} format={(n) => `${Math.round(n)}+`} />,
    );
    expect(container.textContent).toBe(final);
    await demo();
  });

  it("mouvement réduit: aucune frame demandée, le texte ne bouge pas", async () => {
    reduit = true;
    const { container, demo } = await monter(
      <CountUp a={8400} final={final} format={(n) => `${Math.round(n)}+`} declencheur="montage" />,
    );
    expect(rafAppels).toBe(0);
    expect(container.textContent).toBe(final);
    await demo();
  });

  it("revient à la chaîne du serveur à la fin, pas à une valeur recomposée", async () => {
    const { container, demo } = await monter(
      <CountUp a={8400} final={final} format={(n) => `${Math.round(n * 0.999)}+`} />,
    );
    // Déclencheur « vue » (le défaut): c'est l'entrée dans le viewport qui lance la montée — donc
    // l'animation ne doit RIEN avoir joué avant, et doit être jouée juste après.
    expect(rafAppels).toBe(0);
    entrer();
    await act(async () => defilerRaf());
    expect(rafAppels).toBeGreaterThan(0);
    // `format` ment volontairement ci-dessus (×0,999): si la fin dépendait de l'accumulateur, le texte
    // serait « 8391+ ». Il est bien verrouillé sur la prop `final`.
    expect(container.textContent).toBe(final);
    await demo();
  });

  it("les chiffres sont tabulaires (sinon la ligne saute pendant la montée)", async () => {
    const { container, demo } = await monter(<CountUp a={4.8} final="4,8/5" />);
    expect(container.querySelector("[data-countup]")?.className).toContain("tabular-nums");
    await demo();
  });
});

// —————————————————————————————————— 3. scroll: un seul bus, des écritures DOM
describe("ScrollProgress et Parallax — le scroll ne re-render pas la page", () => {
  it("écrit la progression en variable CSS sur son propre nœud", async () => {
    const { container, demo } = await monter(<ScrollProgress />);
    const noeud = container.querySelector("[data-scroll-progress]") as HTMLElement;
    expect(noeud).not.toBeNull();
    Object.defineProperty(window, "scrollY", { configurable: true, value: 800 });
    Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 2400 });
    Object.defineProperty(document.documentElement, "clientHeight", { configurable: true, value: 800 });
    await act(async () => {
      window.dispatchEvent(new Event("scroll"));
      defilerRaf();
    });
    expect(parseFloat(noeud.style.getPropertyValue("--p"))).toBeGreaterThan(0);
    expect(parseFloat(noeud.style.getPropertyValue("--p"))).toBeLessThanOrEqual(1);
    await demo();
  });

  it("traduit le visuel en px sous mouvement autorisé, le laisse à plat sinon", async () => {
    Object.defineProperty(window, "scrollY", { configurable: true, value: 640 });
    const un = await monter(<Parallax amplitude={20}>x</Parallax>);
    await act(async () => {
      window.dispatchEvent(new Event("scroll"));
      defilerRaf();
    });
    expect(un.container.querySelector("[data-parallax]")?.getAttribute("class")).toContain("parallax");
    const valeur = (un.container.querySelector("[data-parallax]") as HTMLElement).style.getPropertyValue("--py");
    expect(parseFloat(valeur)).toBeGreaterThan(0);
    await un.demo();

    reduit = true;
    const deux = await monter(<Parallax amplitude={20}>x</Parallax>);
    await act(async () => {
      window.dispatchEvent(new Event("scroll"));
      defilerRaf();
    });
    expect((deux.container.querySelector("[data-parallax]") as HTMLElement).style.getPropertyValue("--py")).toBe("");
    await deux.demo();
  });
});

// —————————————————————————————————— 4. les échappatoires sont dans le CSS, pas dans le JS
describe("Contract CSS de la couche de mouvement", () => {
  const css = readFileSync(join(ROOT, "app/globals.css"), "utf8");

  it("[data-reveal] part caché et est libéré par data-shown", () => {
    expect(/\[data-reveal\]\s*\{[^}]*opacity:\s*0/.test(css)).toBe(true);
    expect(css).toContain('[data-reveal][data-shown="true"]');
  });

  it("prefers-reduced-motion annule l'état caché lui-même, pas seulement la durée", () => {
    const bloc = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(bloc).toMatch(/\[data-reveal\]\s*\{[^}]*opacity:\s*1\s*!important/);
    expect(bloc).toMatch(/scroll-behavior:\s*auto/);
  });

  it("le repli sans JavaScript est posé dans le <head> du layout racine", () => {
    const layout = readFileSync(join(ROOT, "app/layout.tsx"), "utf8");
    expect(layout).toContain("<noscript>");
    expect(layout).toMatch(/noscript>[\s\S]*\[data-reveal\]\{opacity:1!important/);
  });

  it("la barre de lecture se pilote en scaleX, jamais en largeur", () => {
    const bloc = css.slice(css.indexOf("[data-scroll-progress]"));
    expect(bloc).toMatch(/transform:\s*scaleX\(var\(--p/);
    expect(bloc).not.toMatch(/width:\s*calc/);
  });

  it("aucun keyframe orphelin (même garde que check:hydration, côté test)", () => {
    const orphelins = [...css.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)]
      .map((m) => m[1])
      .filter((nom) => !new RegExp("animation[^;]*\\b" + nom + "\\b").test(css));
    expect(orphelins).toEqual([]);
  });
});
