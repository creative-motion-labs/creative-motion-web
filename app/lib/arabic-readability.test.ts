/**
 * Unit tests for arabic-readability.ts helper functions
 * Run: npx tsx --test app/lib/arabic-readability.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  containsArabic,
  valueTextDirection,
  isArabicAssessmentContent,
} from "./arabic-readability";

describe("containsArabic", () => {
  it("returns true for Arabic text from the supported basic Arabic range", () => {
    assert.equal(containsArabic("مرحبا"), true);
    assert.equal(containsArabic("السلام عليكم"), true);
    assert.equal(containsArabic("الألم"), true);
  });

  it("returns true for mixed Arabic and English text", () => {
    assert.equal(containsArabic("Hello مرحبا"), true);
    assert.equal(containsArabic("Pain score: الألم"), true);
    assert.equal(containsArabic("مرحبا World"), true);
  });

  it("returns false for English-only text", () => {
    assert.equal(containsArabic("Hello world"), false);
    assert.equal(containsArabic("Pain score"), false);
    assert.equal(containsArabic("ABCDEFGHIJKLMNOPQRSTUVWXYZ"), false);
  });

  it("returns false for digits and punctuation without Arabic", () => {
    assert.equal(containsArabic("12345"), false);
    assert.equal(containsArabic("!@#$%^&*()"), false);
    assert.equal(containsArabic("123 ABC !@#"), false);
  });

  it("returns false for empty and whitespace-only strings", () => {
    assert.equal(containsArabic(""), false);
    assert.equal(containsArabic("   "), false);
    assert.equal(containsArabic("\n\t"), false);
  });
});

describe("valueTextDirection", () => {
  it("returns rtl for Arabic text", () => {
    assert.equal(valueTextDirection("مرحبا"), "rtl");
    assert.equal(valueTextDirection("السلام عليكم"), "rtl");
    assert.equal(valueTextDirection("الألم الشديد"), "rtl");
  });

  it("returns rtl for mixed text containing Arabic", () => {
    assert.equal(valueTextDirection("Hello مرحبا"), "rtl");
    assert.equal(valueTextDirection("مرحبا World"), "rtl");
    assert.equal(valueTextDirection("123 الألم"), "rtl");
  });

  it("returns ltr for English text", () => {
    assert.equal(valueTextDirection("Hello world"), "ltr");
    assert.equal(valueTextDirection("Pain level 5"), "ltr");
    assert.equal(valueTextDirection("ABCDEFG"), "ltr");
  });

  it("returns ltr for empty or whitespace-only text", () => {
    assert.equal(valueTextDirection(""), "ltr");
    assert.equal(valueTextDirection("   "), "ltr");
    assert.equal(valueTextDirection("\n\t"), "ltr");
  });
});

describe("isArabicAssessmentContent", () => {
  it("returns true when assessmentLanguage is ar even with empty values", () => {
    assert.equal(isArabicAssessmentContent("ar", []), true);
    assert.equal(isArabicAssessmentContent("ar", [""]), true);
    assert.equal(isArabicAssessmentContent("ar", ["", ""]), true);
  });

  it("returns true when assessmentLanguage is en but a value contains Arabic", () => {
    assert.equal(isArabicAssessmentContent("en", ["Hello", "مرحبا"]), true);
    assert.equal(isArabicAssessmentContent("en", ["الألم"]), true);
  });

  it("returns true when assessmentLanguage is null or undefined but a value contains Arabic", () => {
    assert.equal(isArabicAssessmentContent(null, ["مرحبا"]), true);
    assert.equal(isArabicAssessmentContent(undefined, ["السلام"]), true);
  });

  it("returns false for English-only values", () => {
    assert.equal(isArabicAssessmentContent("en", ["Hello world"]), false);
    assert.equal(isArabicAssessmentContent("en", ["Pain", "Score"]), false);
    assert.equal(isArabicAssessmentContent(null, ["Test"]), false);
  });

  it("returns false for empty values", () => {
    assert.equal(isArabicAssessmentContent("en", []), false);
    assert.equal(isArabicAssessmentContent(null, []), false);
    assert.equal(isArabicAssessmentContent(undefined, []), false);
  });

  it("returns false for whitespace-only values", () => {
    assert.equal(isArabicAssessmentContent("en", ["   "]), false);
    assert.equal(isArabicAssessmentContent("en", [" ", "\n", "\t"]), false);
    assert.equal(isArabicAssessmentContent(null, ["  ", "  "]), false);
  });

  it("detects Arabic even when empty strings precede it", () => {
    assert.equal(isArabicAssessmentContent("en", ["", "", "مرحبا"]), true);
    assert.equal(isArabicAssessmentContent(null, ["  ", "Hello", "الألم"]), true);
  });
});
