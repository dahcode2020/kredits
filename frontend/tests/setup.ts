process.env.TZ = "Europe/Brussels";

// jsdom ne fournit pas TextEncoder/TextDecoder, dont react-dom/server a besoin
// pour rendre un composant dans un test d'hydratation.
const util = require("util");
if (typeof globalThis.TextEncoder === "undefined") (globalThis as any).TextEncoder = util.TextEncoder;
if (typeof globalThis.TextDecoder === "undefined") (globalThis as any).TextDecoder = util.TextDecoder;

if (typeof window !== "undefined") {
  // Défini MÊME quand jsdom en fournit un: celui de jsdom est non configurable, et un composant qui
  // lit `prefers-reduced-motion` ne peut alors être testé dans les deux états qu'en le remplaçant.
  // Le comportement par défaut reste `matches: false` — seules les specs qui posent leur propre
  // `mockImplementation` le peuvent.
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: jest.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  });
}
