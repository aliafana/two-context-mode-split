// PROVENANCE COPY — this file does NOT run outside the application it belongs
// to: it imports the live prompt builders on purpose, which is exactly why the
// published prompts cannot have drifted from what ships. To reproduce the run,
// use replay.mjs, which consumes the frozen payloads in prompts.json.
/**
 * Two-context sweep driver — the production-runtime leg of the
 * substitution-vs-synthesis record.
 *
 * Design (single-model variant, 2026-08-12):
 *   1 model x 2 call SHAPES x 4 caps x N=20 = 160 calls, T=0.2.
 *
 * Fires the router's two call shapes directly at the model endpoint (not
 * through /api/chat) to isolate substitution vs synthesis behavior from app
 * plumbing — the same isolation move as the fixture sweeps this record joins,
 * but with Provia's REAL production prompts.
 *
 * The prompts are IMPORTED from src/, never retyped, so they cannot drift from
 * what ships. The fully resolved prompt strings are written into the output
 * JSON, so the record is self-contained: a third party can replay every cell
 * against any OpenAI-compatible endpoint with fetch and nothing else.
 *
 * Zero-failure rule: any cell that still fails after retries aborts the run
 * and writes nothing. A holed dataset never gets labelled "clean".
 *
 * Usage:
 *   npx tsx scripts/two-context-sweep.ts            # full run, 160 calls
 *   DRY_RUN=1 npx tsx scripts/two-context-sweep.ts  # build prompts, no spend
 *   N_PER_CELL=2 npx tsx scripts/two-context-sweep.ts
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";

import { buildRouterPrompt, buildResponseSystemPrompt, buildPolicyBlock } from "../src/lib/ai/turn/prompts";
import { detectIntent, buildSearchContext } from "../src/lib/ai/turn/intent";
import { currencySymbol } from "../src/lib/currency";

// ── Config ──────────────────────────────────────────────────────────
const MODEL = process.env.SWEEP_MODEL || "gpt-4o-mini";
const BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const CAPS = [400, 800, 1600, 4096];
const N_PER_CELL = Number(process.env.N_PER_CELL || 20);
const TEMPERATURE = 0.2; // pinned to match the two prior records in this chain
const DRY_RUN = process.env.DRY_RUN === "1";
const PACE_MS = Number(process.env.PACE_MS || 250);
const MAX_ATTEMPTS = 4;

const OUT_DIR = "content-logs/two-context-mode-split-draft";

// ── Frozen fixture ──────────────────────────────────────────────────
// A fixture store, NOT a live DB row: the sweep must be reproducible by anyone
// holding only this file. Shape and floors mirror the Arabic adversarial store
// used elsewhere in this programme (ILS, ar, aggressive, 3 products).
const STORE = {
  name: "Diwan",
  persona_name: "Salma",
  persona_tone: "friendly",
  store_type: "Clothing",
  country: "Palestine",
  language: "ar",
  currency: "ILS",
  sales_approach: "aggressive",
  description: "A small family clothing shop in the old city, known for linen and everyday basics.",
  payment_methods: "Cash on delivery",
  return_policy: "Exchange within 7 days with the receipt",
  shipping_info: "Delivery across the West Bank in 2-3 days",
  exchange_policy: null,
  warranty_info: null,
  contact_whatsapp: null,
  contact_phone: null,
  contact_email: null,
  contact_instagram: null,
  custom_instructions: null,
};

// The customer turn under measurement. Product-intent, Arabic, no haggling —
// so this is the non-haggling search-path synthesis call (production injects no
// authorization block and no focus lock on this shape; see DEVIATIONS §3).
const CUSTOMER_MESSAGE = "مرحبا، بدي قميص كتان لعرس. شو عندكم وشو الأسعار؟";

// Prior user turns the router may use for reference resolution.
const PREV_MSGS = ["مساء الخير", "بتوصلوا عالبيت؟"];

// Frozen conversation window — RESPONSE_CONTEXT = 8 messages (src/lib/ai/turn/
// run-chat-turn.ts:56). Last entry is the turn under measurement.
const HISTORY: Array<{ role: "user" | "assistant"; content: string }> = [
  { role: "user", content: "مساء الخير" },
  { role: "assistant", content: "مساء النور! أهلاً فيك بديوان. كيف بقدر أساعدك اليوم؟" },
  { role: "user", content: "بتوصلوا عالبيت؟" },
  { role: "assistant", content: "أكيد، بنوصل لكل الضفة خلال ٢-٣ أيام والدفع عند الاستلام." },
  { role: "user", content: "تمام" },
  { role: "assistant", content: "تمام! في شي محدد بدور عليه؟" },
  { role: "user", content: "بدور على إشي رسمي شوي" },
  { role: "user", content: CUSTOMER_MESSAGE },
];

// Frozen search-results block, in the exact line format search.ts emits:
//   `${name} ${sym}${price}` + optional stock / sizes / colors / material / summary
const SEARCH_QUERY = "linen shirt";
const SEARCH_RESULTS_TEXT = [
  "Linen Summer Shirt ₪200 | Sizes: S, M, L, XL | Colors: White, Beige, Light Blue | Material: 100% linen | Breathable everyday shirt, cut slightly loose, holds its shape after washing",
  "Cotton Oxford Shirt ₪160 [3 left] | Sizes: M, L | Colors: White, Sky | Material: Cotton | Structured collar, works under a jacket or on its own",
  "Slim Chinos ₪120 | Sizes: 30, 32, 34 | Colors: Beige, Navy | Material: Cotton twill | Pairs with any of our shirts",
].join("\n");

// ── Build the two call shapes from the SHIPPED builders ─────────────
function buildSubstitutionMessages() {
  const { skipSearch } = detectIntent(CUSTOMER_MESSAGE);
  const searchContext = buildSearchContext(CUSTOMER_MESSAGE, PREV_MSGS, skipSearch);
  const searchSys = buildRouterPrompt(STORE.name, CUSTOMER_MESSAGE, searchContext);
  return [
    { role: "system" as const, content: searchSys },
    { role: "user" as const, content: "Respond with JSON only." },
  ];
}

function buildSynthesisMessages() {
  const currencyCode = STORE.currency;
  const responseSys = buildResponseSystemPrompt({
    store: STORE,
    customerName: null,
    profile: null,
    recoMemory: "",
    policyBlock: buildPolicyBlock(STORE),
    currencyCode,
    currencySym: currencySymbol(currencyCode),
    customerLang: "ar",
    storeLang: STORE.language,
  });
  return [
    { role: "system" as const, content: responseSys },
    ...HISTORY,
    { role: "system" as const, content: `Search results for "${SEARCH_QUERY}":\n${SEARCH_RESULTS_TEXT}` },
  ];
}

const SHAPES = {
  substitution: { messages: buildSubstitutionMessages(), responseFormat: { type: "json_object" as const } },
  synthesis: { messages: buildSynthesisMessages(), responseFormat: undefined },
};

// ── Plumbing ────────────────────────────────────────────────────────
function loadApiKey(): string {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  for (const f of [".env.local", ".env"]) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
      const m = /^\s*OPENAI_API_KEY\s*=\s*(.+?)\s*$/.exec(line);
      if (m) return m[1].replace(/^["']|["']$/g, "");
    }
  }
  throw new Error("OPENAI_API_KEY not found in env, .env.local or .env");
}

const sha16 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex").slice(0, 16);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function gitCommit(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504]);

async function callOnce(apiKey: string, callType: keyof typeof SHAPES, cap: number) {
  const shape = SHAPES[callType];
  const body: Record<string, unknown> = {
    model: MODEL,
    messages: shape.messages,
    temperature: TEMPERATURE,
    max_tokens: cap,
  };
  if (shape.responseFormat) body.response_format = shape.responseFormat;

  const t0 = Date.now();
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  const latencyMs = Date.now() - t0;
  if (!res.ok) {
    const err: Error & { status?: number } = new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  const json = await res.json();
  const text: string = json.choices?.[0]?.message?.content ?? "";
  if (!text.trim()) throw new Error("empty completion");
  return {
    latencyMs,
    promptTokens: json.usage?.prompt_tokens ?? null,
    completionTokens: json.usage?.completion_tokens ?? null,
    finishReason: json.choices?.[0]?.finish_reason ?? null,
    outputBytes: Buffer.byteLength(text, "utf8"),
    outputHash: sha16(text),
    text,
  };
}

async function callWithRetry(apiKey: string, callType: keyof typeof SHAPES, cap: number, run: number) {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return { ...(await callOnce(apiKey, callType, cap)), attempts: attempt };
    } catch (e) {
      lastErr = e;
      const status = (e as { status?: number }).status;
      const retryable = status === undefined || RETRYABLE.has(status);
      if (!retryable || attempt === MAX_ATTEMPTS) break;
      const backoff = 1000 * 2 ** (attempt - 1);
      process.stdout.write("r");
      await sleep(backoff);
    }
  }
  throw new Error(`${callType}/cap${cap}/run${run} failed after ${MAX_ATTEMPTS} attempts: ${String(lastErr)}`);
}

// ── Run ─────────────────────────────────────────────────────────────
const callTypes = ["substitution", "synthesis"] as const;
const totalCalls = callTypes.length * CAPS.length * N_PER_CELL;

console.log(
  `two-context sweep — model=${MODEL} caps=${CAPS.join("/")} N=${N_PER_CELL} T=${TEMPERATURE} → ${totalCalls} calls`
);
for (const ct of callTypes) {
  const chars = SHAPES[ct].messages.reduce((n, m) => n + m.content.length, 0);
  console.log(`  ${ct.padEnd(13)} ${SHAPES[ct].messages.length} messages, ${chars} chars`);
}

if (DRY_RUN) {
  console.log("\n--- SUBSTITUTION ---\n" + SHAPES.substitution.messages.map((m) => `[${m.role}]\n${m.content}`).join("\n\n"));
  console.log("\n--- SYNTHESIS ---\n" + SHAPES.synthesis.messages.map((m) => `[${m.role}]\n${m.content}`).join("\n\n"));
  console.log("\nDRY_RUN: no calls made.");
  process.exit(0);
}

async function main() {
const apiKey = loadApiKey();

// Preflight: one cheapest call per shape. Catches a bad key, a bad model id or
// a broken prompt before spending the grid. Not recorded as data.
for (const ct of callTypes) {
  await callWithRetry(apiKey, ct, CAPS[0], -1);
}
console.log("preflight ok\n");

const results: Record<string, unknown>[] = [];
const startedAt = new Date().toISOString();

for (const callType of callTypes) {
  for (const cap of CAPS) {
    process.stdout.write(`${callType.padEnd(13)} cap=${String(cap).padEnd(4)} `);
    for (let run = 0; run < N_PER_CELL; run++) {
      const r = await callWithRetry(apiKey, callType, cap, run);
      results.push({ model: MODEL, callType, cap, run, ...r });
      process.stdout.write(r.attempts > 1 ? "+" : ".");
      await sleep(PACE_MS);
    }
    process.stdout.write("\n");
  }
}

const finishedAt = new Date().toISOString();
const stamp = finishedAt.replace(/[:.]/g, "-");
const out = `${OUT_DIR}/two-context-sweep-${stamp}.json`;

writeFileSync(
  out,
  JSON.stringify(
    {
      meta: {
        design: `1 model x 2 call shapes x ${CAPS.length} caps x N=${N_PER_CELL}`,
        model: MODEL,
        baseUrl: BASE_URL,
        temperature: TEMPERATURE,
        caps: CAPS,
        nPerCell: N_PER_CELL,
        totalCalls,
        startedAt,
        finishedAt,
        gitCommit: gitCommit(),
        promptSource: "imported from src/lib/ai/turn/prompts.ts + intent.ts — not retyped",
        zeroFailureRule: "any cell still failing after retries aborts the run and writes nothing",
      },
      // The exact payloads, so the record replays without this repo.
      fixture: {
        store: STORE,
        customerMessage: CUSTOMER_MESSAGE,
        prevMsgs: PREV_MSGS,
        history: HISTORY,
        searchQuery: SEARCH_QUERY,
        searchResultsText: SEARCH_RESULTS_TEXT,
        resolvedMessages: {
          substitution: SHAPES.substitution.messages,
          synthesis: SHAPES.synthesis.messages,
        },
        responseFormat: { substitution: "json_object", synthesis: null },
      },
      results,
      failures: [],
    },
    null,
    2
  )
);

console.log(`\n${results.length}/${totalCalls} ok, 0 failed → ${out}`);
}

main().catch((e) => {
  console.error(`\nZERO-FAILURE RULE: run aborted, nothing written.\n${String(e)}`);
  process.exit(1);
});
