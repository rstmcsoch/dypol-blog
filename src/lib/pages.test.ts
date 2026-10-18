import assert from "node:assert/strict";
import { describe, it } from "node:test";

const baseExpect = (v: unknown) => ({
  toBe: (e: unknown) => assert.equal(v, e),
  toBeNull: () => assert.equal(v, null),
  toContain: (e: unknown) => assert.ok(String(v).includes(String(e)), `${String(v).slice(0,60)} should contain ${String(e)}`),
  toMatch: (e: RegExp) => assert.match(String(v), e),
  toHaveLength: (e: number) => assert.equal((v as unknown[]).length, e),
  toBeGreaterThan: (e: number) => assert.ok((v as number) > e),
});
const expect = (v: unknown) => ({
  ...baseExpect(v),
  not: { toContain: (e: unknown) => assert.ok(!String(v).includes(String(e)), `should NOT contain ${String(e)}`) },
});
import { STANDARD_PAGES, STANDARD_PAGE_SLUGS, standardPage } from "../content/pages-seed.ts";
import { checkPageSlug, pageExcerpt, pageWriteSchema, slugifyPageTitle } from "./pages.ts";

describe("standard pages (t52)", () => {
  it("ships the nine standard pages with unique, valid slugs", () => {
    expect(STANDARD_PAGES).toHaveLength(9);
    expect(new Set(STANDARD_PAGE_SLUGS).size).toBe(9);
    for (const page of STANDARD_PAGES) {
      expect(checkPageSlug(page.slug)).toBeNull();
      expect(page.body.length).toBeGreaterThan(400);
      expect(page.description.length).toBeGreaterThan(30);
    }
    expect(standardPage("about")?.title).toBe("About Us");
    expect(standardPage("privacy-policy")?.body).toContain("18 October 2026");
    expect(standardPage("editorial-policy")?.body).toMatch(/AI systems/);
    expect(standardPage("editorial-policy")?.body).toMatch(/human editor/);
  });

  it("no page contains the old self-referential copy", () => {
    const banned = ["sample pieces", "white day", "how a story is titled", "later editor"];
    for (const page of STANDARD_PAGES) {
      for (const phrase of banned) expect(page.body.toLowerCase()).not.toContain(phrase);
    }
  });

  it("reserves site-owned slugs and validates writes", () => {
    expect(checkPageSlug("articles")).toMatch(/used by the site/);
    expect(checkPageSlug("Bad Slug")).toMatch(/lowercase/);
    expect(checkPageSlug("privacy-policy")).toBeNull();
    expect(pageWriteSchema.safeParse({ slug: "x", title: "X", body: "b", status: "published" }).success).toBe(true);
    expect(pageWriteSchema.safeParse({ slug: "x", title: "X", body: "b", status: "live" }).success).toBe(false);
    expect(slugifyPageTitle("Privacy Policy!")).toBe("privacy-policy");
  });

  it("excerpts skip headings and markdown furniture", () => {
    const ex = pageExcerpt("## Heading\n\nThe **first** real sentence is here.", "fb");
    expect(ex).toBe("The first real sentence is here.");
    expect(pageExcerpt("## Only heading", "fallback")).toBe("fallback");
  });
});
