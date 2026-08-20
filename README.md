# two-context-mode-split

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.21924472.svg)](https://doi.org/10.5281/zenodo.21924472)

**Substitution and synthesis calls under a token-cap sweep, measured on a production LLM sales router.**

160 calls, zero failures, `gpt-4o-mini`, T=0.2, N=20 per cell, caps 400 / 800 / 1600 / 4096.
The prompts are the ones the router actually ships — imported from the running application's
prompt builders, never retyped — and the fully resolved payloads are published here so the run
replays with `fetch` and nothing else.

## Headline

**Substitution is flat, and on this stack it is exactly flat.**

| cap | 400 | 800 | 1600 | 4096 |
|---|---|---|---|---|
| completion tokens (min = median = max) | **49** | **49** | **49** | **49** |
| truncated (`finish_reason: length`) | 0/20 | 0/20 | 0/20 | 0/20 |
| distinct outputs | 1/20 | 1/20 | 1/20 | 1/20 |

Across all 80 substitution calls there is **one distinct output hash** — byte-identical, 80 times,
over a 10× cap range. 49 tokens is 1.2% of the largest cap tested.

**Synthesis does not track the cap here, and the reason is the interesting part.**

| cap | 400 | 800 | 1600 | 4096 |
|---|---|---|---|---|
| completion tokens (median) | 127.5 | 130.5 | 118.5 | 122.5 |
| within-cell range | 63 | 48 | 48 | 51 |
| truncated | 0/20 | 0/20 | 0/20 | 0/20 |

Medians move 12 tokens across a 10× cap range, non-monotonically, while run-to-run variation
inside a single cell is 48–63 tokens. Cap explains nothing. The natural suspect was the response
prompt's instruction `2-4 sentences.` — so v1.1.0 deleted exactly that sentence from the frozen
payload (a byte-verified 15-byte change) and re-ran the grid against a same-day fresh control:
pooled medians moved **127 → 138.5 (1.09×)**, zero truncations, max 174 against a 4096 cap. The
effect is real — ~4× the standard error of the paired difference, with every instruction-removed
cell above every control cell — and bounded: removing the instruction lengthens the reply by ~9%
and no more. **The instruction is a contributor, not the binding constraint; the
order-of-magnitude gap to every cap is governed by the model's own natural answer length.**
Full arm: [`instruction-off/`](instruction-off/).

This **bounds** the workload-gradient result from the middleware leg below; it does not contradict
it. A gradient is a property of synthesis calls allowed to run to their natural stop — and on this
stack the natural stop itself sits an order of magnitude below every cap. A production sales reply
is length-instructed by construction; the instruction trims about 9% from where the model would
stop on its own — a contributor, not the governor. Whether the absence of a reasoning trace is
what places that floor is the middleware leg's axis; it was not varied on this stack.

`finish_reason` is `stop` on 160/160 calls. Full tables, deviations and threats to validity are in
[`analysis.md`](analysis.md).

## Methodology

- **Endpoint:** OpenAI-compatible `/chat/completions`. Model `gpt-4o-mini`.
- **Temperature 0.2**, pinned to match the two prior legs in this chain. The application passes no
  temperature at all, i.e. runs at the provider default — so the byte-level determinism above is a
  T=0.2 result, not a claim about the deployment.
- **N = 20** per cell, 2 call shapes × 4 caps = 8 cells = 160 calls.
- **Two call shapes**, taken from the router's own two model calls:
  - *substitution* — the routing call: stateless, `response_format: json_object`, 2 messages, 531
    prompt tokens.
  - *synthesis* — the response call: persona + policies + an 8-message conversation window +
    retrieved product lines, 10 messages, 1,168 prompt tokens.
- **Fixture, not a live record:** a frozen store configuration and a frozen customer turn, so the
  run reproduces without the application's database.
- **Zero-failure rule:** a cell that still fails after retries aborts the run and writes nothing.
  A dataset with holes must never be labelled clean.
- **Cost:** 135,920 prompt + 13,988 completion tokens ≈ $0.03.

## Files

| file | what it is |
|---|---|
| `analysis.md` | the full result: both call shapes, the deployment-side findings, deviations, threats to validity |
| `two-context-sweep-*.json` | raw data, all 160 cells, including the resolved prompts |
| `prompts.json` | the frozen prompt payloads, extracted from the run |
| `replay.mjs` | standalone replay driver — stdlib + `fetch`, zero dependencies, runs anywhere |
| `check-numerals.mjs` | re-derives the §3.2 counts from the raw data alone, no network, no application source |
| `two-context-sweep.ts` | the original driver, kept as provenance: it *imports* the prompt builders from the running application rather than copying them, which is why the published prompts cannot have drifted from what ships. It does not run outside that application — use `replay.mjs` |
| `instruction-off/` | **v1.1.0** — the attribution arm: the length instruction deleted from the frozen payload (byte-verified single-span change), 80+80 calls against a same-day control. Answers *which constraint actually binds* |

Replay the whole grid, or one cell:

```bash
OPENAI_API_KEY=sk-... node replay.mjs
OPENAI_API_KEY=sk-... N_PER_CELL=3 CAPS=400,4096 SHAPE=synthesis node replay.mjs
```

Any OpenAI-compatible endpoint works, including a local one:

```bash
OPENAI_BASE_URL=http://localhost:11434/v1 SWEEP_MODEL=gemma3:12b OPENAI_API_KEY=x node replay.mjs
```

## Context

This is the production-runtime leg of a three-stack collaboration on the substitution/synthesis
split. The other two legs measured the same distinction on different systems:

- **Robin Converse** (Triava Labs) — sovereign Ollama stack, 26b MoE:
  [`triavalabs/gemma4-26b-mode-split`](https://github.com/triavalabs/gemma4-26b-mode-split).
  Substitution deterministic and flat across repeated runs; synthesis efficiency scaling with
  model size.
- **Jiwon Seo** (Hashevolution) — JAMES cognitive middleware, gemma4:e4b:
  [10.5281/zenodo.20363998](https://doi.org/10.5281/zenodo.20363998) — a seven-tier
  natural-stop gradient (synthesis output tracking task weight), closed in
  [PR #461](https://github.com/Hashevolution/James-RAG-Evol/pull/461) and
  [PR #463](https://github.com/Hashevolution/James-RAG-Evol/pull/463); the earlier
  two-mode / three-workload split is
  [PR #440](https://github.com/Hashevolution/James-RAG-Evol/pull/440). Cross-stack numbers
  from the Converse leg are in
  [Issue #448](https://github.com/Hashevolution/James-RAG-Evol/issues/448).

What this leg adds that a fixture sweep cannot: the same two call shapes measured **through a
production runtime** — persona, store policies, a sales-mode block, a dialect guide, grounding
rules and a negotiation contract all wrapped around them. Two results follow from that and only
from that: the length instruction pre-empting the cap, and the deployment-configuration finding in
`analysis.md` §3.2.

The three-way finding itself is to be archived in a joint record under all three authors; this
repository is the per-stack engineering record that feeds it.

## Changelog

- **v1.1.0 (2026-08-19)** — adds the instruction-removed arm under
  [`instruction-off/`](instruction-off/), prompted by Jiwon Seo's review of v1.0.0 (the
  instruction/no-trace confound). Result: neither cap nor instruction binds — the model's
  visible-answer floor does. `replay.mjs` gains an optional `PROMPTS=<path>` env var for
  alternate frozen payloads; the headline and Layer-2 conclusions are updated to the measured
  attribution; the seven-tier citation in Context is corrected to PRs #461/#463 (per Seo).
  Zenodo: [10.5281/zenodo.22013372](https://doi.org/10.5281/zenodo.22013372)
  (new version under the same record; concept DOI 10.5281/zenodo.21924472
  always resolves to the latest version).
- **v1.0.0 (2026-08-14)** — initial record: [10.5281/zenodo.21924473](https://doi.org/10.5281/zenodo.21924473).

## Citation

```
Afana, A. (2026). Two-Context Mode Split: Substitution vs Synthesis under a
Token-Cap Sweep on a Production Arabic Sales Router (v1.1.0) [Data set].
Zenodo. https://doi.org/10.5281/zenodo.22013372
```

## License

MIT — see [`LICENSE`](LICENSE). Research artifact; raw data included.
