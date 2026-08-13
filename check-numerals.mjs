#!/usr/bin/env node
/**
 * Re-derives the numeral counts in analysis.md §3.2 from the published raw
 * data. Zero dependencies, no network, no application source — everything it
 * needs is in the run JSON.
 *
 * Usage: node check-numerals.mjs two-context-sweep-2026-08-12T12-27-16-764Z.json
 */
import { readFileSync, readdirSync } from "node:fs";

const file =
  process.argv[2] || readdirSync(".").find((f) => f.startsWith("two-context-sweep-") && f.endsWith(".json"));
if (!file) {
  console.error("usage: node check-numerals.mjs <run.json>");
  process.exit(1);
}
const replies = JSON.parse(readFileSync(file, "utf8")).results.filter((r) => r.callType === "synthesis");

const AR_INDIC = /[٠-٩]/; // ٠-٩
const EASTERN = /[۰-۹]/; // ۰-۹
const ASCII = /[0-9]/;

// Prices in the fixture catalog. A reply "quotes a price" if one appears in any
// numeral system; the ASCII-only class below is what the application's price
// extractor can see, and is the entire point of the comparison.
const CATALOG = [200, 160, 120];
const toAscii = (s) =>
  s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
const quotes = (t) => CATALOG.filter((p) => new RegExp(`(^|[^0-9])${p}([^0-9]|$)`).test(toAscii(t)));

let ar = 0, east = 0, asciiOnly = 0, none = 0, quoted = 0, asciiReadable = 0;
for (const r of replies) {
  const t = r.text;
  const a = AR_INDIC.test(t), e = EASTERN.test(t), s = ASCII.test(t);
  if (a) ar++;
  if (e) east++;
  if (!a && !e && s) asciiOnly++;
  if (!a && !e && !s) none++;
  if (quotes(t).length) {
    quoted++;
    // Could an ASCII-only extractor read any catalog price as written?
    if (CATALOG.some((p) => new RegExp(`(^|[^0-9])${p}([^0-9]|$)`).test(t))) asciiReadable++;
  }
}

const n = replies.length;
const row = (label, x) => console.log(`${label.padEnd(46)} ${x}/${n} (${Math.round((x / n) * 100)}%)`);
console.log(`\n${n} synthesis replies from ${file}\n`);
row("contain Arabic-Indic digits ٠-٩", ar);
row("contain Eastern-Arabic digits ۰-۹", east);
row("ASCII digits only", asciiOnly);
row("no digits at all", none);
console.log();
row("quote a catalog price (any numeral system)", quoted);
row("...readable by an ASCII-only extractor", asciiReadable);
console.log(`\nThe fixture customer message contains no digits in any system:`);
console.log(`  "${JSON.parse(readFileSync(file, "utf8")).fixture.customerMessage}"\n`);
