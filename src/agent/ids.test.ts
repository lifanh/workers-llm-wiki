import { describe, expect, test } from "vitest";
import { slugify, sourceIdFromName, sourceIdFromUrl } from "./ids";

describe("slugify", () => {
  test("lowercases and replaces non-alphanumerics with hyphens", () => {
    expect(slugify("Hello World!")).toBe("hello-world");
  });
  test("collapses repeats, trims leading/trailing hyphens", () => {
    expect(slugify("  Foo -- Bar __ baz  ")).toBe("foo-bar-baz");
  });
  test("truncates to 60 chars", () => {
    const long = "a".repeat(100);
    expect(slugify(long).length).toBeLessThanOrEqual(60);
  });
  test("returns 'untitled' for empty/garbage input", () => {
    expect(slugify("")).toBe("untitled");
    expect(slugify("   !!!  ")).toBe("untitled");
  });
});

describe("sourceIdFromName", () => {
  test("prefixes with given date and strips extension", () => {
    expect(sourceIdFromName("Some Article.pdf", "2026-04-26")).toBe(
      "2026-04-26-some-article",
    );
  });
});

describe("sourceIdFromUrl", () => {
  test("uses hostname and path tail", () => {
    expect(
      sourceIdFromUrl("https://example.com/blog/foo-bar?x=1", "2026-04-26"),
    ).toBe("2026-04-26-example-com-foo-bar");
  });
  test("falls back to hostname only when path is empty", () => {
    expect(sourceIdFromUrl("https://example.com/", "2026-04-26")).toBe(
      "2026-04-26-example-com",
    );
  });
});
