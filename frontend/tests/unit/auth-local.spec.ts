/**
 * @jest-environment node
 */
/**
 * Portail local (slice 4) — partie pure, testable en Node :
 * - l'email doit être plausible avant toute recherche de compte ;
 * - la majorité exigée à l'inscription se calcule en années révolues, au jour près, et une date
 *   invalide ne peut pas passer pour majeure.
 */
import { ageEnAnnees, emailValide } from "@/lib/auth";

describe("emailValide", () => {
  it("accepte les adresses plausibles", () => {
    expect(emailValide("sofie@kredit.be")).toBe(true);
    expect(emailValide("  tom.v@mail.example  ")).toBe(true);
  });
  it("refuse les trous", () => {
    for (const s of ["", "a@b", "a b@c.de", "@kredit.be", "x@y.z"]) expect(emailValide(s)).toBe(false);
  });
});

describe("ageEnAnnees", () => {
  const ref = new Date(Date.UTC(2026, 8, 13)); // 2026-09-13
  it("au jour près", () => {
    expect(ageEnAnnees("2008-09-13", ref)).toBe(18);
    expect(ageEnAnnees("2008-09-14", ref)).toBe(17);
    expect(ageEnAnnees("2008-09-12", ref)).toBe(18);
  });
  it("date invalide → jamais majeure", () => {
    expect(ageEnAnnees("pas-une-date", ref)).toBe(-1);
    expect(ageEnAnnees("", ref)).toBe(-1);
  });
});
