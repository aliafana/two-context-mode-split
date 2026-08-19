#!/usr/bin/env node
/**
 * Standalone replay driver for the two-context sweep.
 *
 * Zero dependencies: Node's standard library and fetch, nothing else. It reads
 * the frozen prompt payloads from prompts.json, so it reproduces the published
 * run without the application source the prompts came from.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... node replay.mjs                  # full grid, 160 calls
 *   OPENAI_API_KEY=sk-... N_PER_CELL=2 node replay.mjs     # cheap smoke
 *   OPENAI_API_KEY=... CAPS=400,4096 SHAPE=synthesis node replay.mjs
 *
 * Any OpenAI-compatible endpoint works:
 *   OPENAI_BASE_URL=http://localhost:11434/v1 SWEEP_MODEL=gemma3:12b node replay.mjs
 *
 * PROMPTS=<path> replays an alternate frozen payload (default: prompts.json
 * beside this script) — e.g. the v1.1.0 instruction-removed arm:
 *   PROMPTS=instruction-off/variant-prompts.json SHAPE=synthesis node replay.mjs
 *
 * Zero-failure rule: a cell that still fails after retries aborts the run and
 * writes nothing. A dataset with holes must never be labelled clean.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const spec = JSON.parse(
  readFileSync(process.env.PROMPTS ?? new URL("./prompts.json", import.meta.url), "utf8")
);

const MODEL = process.env.SWEEP_MODEL || spec.model;
const BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const API_KEY = process.env.OPENAI_API_KEY || process.env.API_KEY;
const CAPS = process.env.CAPS ? process.env.CAPS.split(",").map(Number) : spec.caps;
const N_PER_CELL = Number(process.env.N_PER_CELL || spec.nPerCell);
const TEMPERATURE = process.env.TEMPERATURE ? Number(process.env.TEMPERATURE) : spec.temperature;
const SHAPES = process.env.SHAPE ? [process.env.SHAPE] : Object.keys(spec.shapes);
const PACE_MS = Number(process.env.PACE_MS || 250);
const MAX_ATTEMPTS = 4;
const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504]);

if (!API_KEY) {
  console.error("Set OPENAI_API_KEY (any value for a local endpoint that ignores it).");
  process.exit(1);
}

const sha16 = (s) => createHash("sha256").update(s, "utf8").digest("hex").slice(0, 16);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callOnce(shapeName, cap) {
  const shape = spec.shapes[shapeName];
  const body = { model: MODEL, messages: shape.messages, temperature: TEMPERATURE, max_tokens: cap };
  if (shape.response_format) body.response_format = shape.response_format;

  const t0 = Date.now();
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify(body),
  });
  const latencyMs = Date.now() - t0;
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  const json = await res.json();
  const text = json.choices?.[0]?.message?.content ?? "";
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

async function callWithRetry(shapeName, cap, run) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return { ...(await callOnce(shapeName, cap)), attempts: attempt };
    } catch (e) {
      lastErr = e;
      const retryable = e.status === undefined || RETRYABLE.has(e.status);
      if (!retryable || attempt === MAX_ATTEMPTS) break;
      process.stdout.write("r");
      await sleep(1000 * 2 ** (attempt - 1));
    }
  }
  throw new Error(`${shapeName}/cap${cap}/run${run} failed after ${MAX_ATTEMPTS} attempts: ${lastErr}`);
}

const total = SHAPES.length * CAPS.length * N_PER_CELL;
console.log(`replay — model=${MODEL} caps=${CAPS.join("/")} N=${N_PER_CELL} T=${TEMPERATURE} → ${total} calls`);

for (const s of SHAPES) await callWithRetry(s, CAPS[0], -1);
console.log("preflight ok\n");

const results = [];
const startedAt = new Date().toISOString();

for (const shapeName of SHAPES) {
  for (const cap of CAPS) {
    process.stdout.write(`${shapeName.padEnd(13)} cap=${String(cap).padEnd(4)} `);
    for (let run = 0; run < N_PER_CELL; run++) {
      const r = await callWithRetry(shapeName, cap, run);
      results.push({ model: MODEL, callType: shapeName, cap, run, ...r });
      process.stdout.write(r.attempts > 1 ? "+" : ".");
      await sleep(PACE_MS);
    }
    process.stdout.write("\n");
  }
}

const finishedAt = new Date().toISOString();
const out = `replay-${finishedAt.replace(/[:.]/g, "-")}.json`;
writeFileSync(
  out,
  JSON.stringify(
    {
      meta: {
        design: `${SHAPES.length} call shapes x ${CAPS.length} caps x N=${N_PER_CELL}`,
        model: MODEL, baseUrl: BASE_URL, temperature: TEMPERATURE, caps: CAPS,
        nPerCell: N_PER_CELL, totalCalls: total, startedAt, finishedAt,
        promptSource: "prompts.json (frozen)",
      },
      fixture: spec.fixture,
      results,
      failures: [],
    },
    null,
    2
  )
);
console.log(`\n${results.length}/${total} ok, 0 failed → ${out}`);
