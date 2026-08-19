#!/usr/bin/env node
/**
 * Builds the v1.1.0 variant payload: ../prompts.json (the published payload)
 * minus the single explicit length instruction "2-4 sentences. " in the
 * synthesis system message.
 *
 * The removal is done on the RAW FILE TEXT, not via parse -> re-serialize, so
 * the diff against the published payload is exactly one 15-byte span.
 * Verified here:
 *   (1) the marker occurs exactly once in the source;
 *   (2) the output parses as JSON;
 *   (3) parsed objects are deep-equal everywhere EXCEPT
 *       shapes.synthesis.messages[0].content;
 *   (4) that one field differs by exactly the removed sentence.
 *
 * The remaining prompt carries no other explicit length instruction; the
 * implicit brevity pressure of the casual sales register is part of what the
 * arm measures.
 *
 * Run: node make-variant.mjs        (writes ./variant-prompts.json)
 */
import { readFileSync, writeFileSync } from "node:fs";

const SRC = new URL("../prompts.json", import.meta.url);
const OUT = new URL("./variant-prompts.json", import.meta.url);
const MARKER = "2-4 sentences. ";

const raw = readFileSync(SRC, "utf8");
const count = raw.split(MARKER).length - 1;
if (count !== 1) throw new Error(`marker found ${count} times, expected exactly 1`);

const variant = raw.replace(MARKER, "");
if (raw.length - variant.length !== MARKER.length) throw new Error("removal size mismatch");

const a = JSON.parse(raw);
const b = JSON.parse(variant);
const aCopy = JSON.parse(raw); aCopy.shapes.synthesis.messages[0].content = "X";
const bCopy = JSON.parse(variant); bCopy.shapes.synthesis.messages[0].content = "X";
if (JSON.stringify(aCopy) !== JSON.stringify(bCopy))
  throw new Error("payloads differ outside the synthesis system message");

const ca = a.shapes.synthesis.messages[0].content;
const cb = b.shapes.synthesis.messages[0].content;
if (ca.replace(MARKER, "") !== cb) throw new Error("synthesis content differs by more than the marker");
if (ca.length - cb.length !== MARKER.length) throw new Error("content delta != marker length");

writeFileSync(OUT, variant);

const i = ca.indexOf(MARKER);
console.log("variant built and verified -> variant-prompts.json");
console.log(`- marker removed: ${JSON.stringify(MARKER)} (${MARKER.length} chars, 1 occurrence)`);
console.log(`- synthesis system message: ${ca.length} chars -> ${cb.length} chars`);
console.log(`- context, published: ...${ca.slice(Math.max(0, i - 30), i + MARKER.length + 25)}...`);
console.log(`- context, variant:   ...${cb.slice(Math.max(0, i - 30), i + 25)}...`);
