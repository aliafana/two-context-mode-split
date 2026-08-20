# Analysis — Two-Context Mode Split on a Production Stack

**Runs:** `two-context-sweep-2026-08-12T12-27-16-764Z.json` (v1.0.0 · **160/160 cells, zero
failures**) · [`instruction-off/`](instruction-off/) control + variant arms (v1.1.0, 2026-08-19 ·
**160/160, zero failures**)
**Model:** `gpt-4o-mini` · **T** = 0.2 · **N** = 20 per cell · **caps** 400 / 800 / 1600 / 4096
**Cost:** 135,920 prompt + 13,988 completion tokens ≈ $0.03

The two call shapes are not retyped from the application — they are **imported** from its shipped
prompt builders at run time, and the fully resolved message arrays are written into the raw JSON.
`replay.mjs` consumes those frozen payloads, so the record reproduces against any
OpenAI-compatible endpoint with `fetch` and nothing else.

| | substitution (routing call) | synthesis (response call) |
|---|---|---|
| messages | 2 (1,810 chars) | 10 (4,662 chars) |
| output contract | `response_format: json_object` | free text, "2-4 sentences" |
| prompt tokens (measured) | 531 | 1,168 |
| cap the application ships | 160 | 200 |

---

## Layer 1 — Substitution mode (the stateless routing call)

**Question:** the sovereign-stack finding — substitution mode is *floor-immune*, its output
sitting far below every cap — does it replicate on a production router's call, on a different
model family?

**It replicates, in the strongest form the measurement can take.**

| cap | n | completion tokens | truncated | distinct outputs |
|---|---|---|---|---|
| 400 | 20 | **49** (min 49, max 49) | 0/20 | 1/20 |
| 800 | 20 | **49** (49–49) | 0/20 | 1/20 |
| 1600 | 20 | **49** (49–49) | 0/20 | 1/20 |
| 4096 | 20 | **49** (49–49) | 0/20 | 1/20 |

Across all **80 substitution calls there is exactly one distinct output hash**. Not one per cell —
one across the whole shape. Byte-identical, 80 times, over a 10× cap range:

```json
{"action":"search","query":"linen shirt","max_price":null,"min_price":null,"stage":"discovery","lang":"ar","haggle":{"intensity":0,"offered_price":null,"walking_away":false}}
```

49 tokens is **1.2% of the 4096 cap** and **31% of the 160 the application actually ships with**.
The cap is not a constraint on this call at any value tested; it is not in the neighbourhood of
one. Latency is likewise flat (median 1.25–1.43 s, no ordering by cap).

**Cross-stack reading:** the sovereign-stack leg reported the same phenomenon on a 26b MoE local
model — deterministic, flat, low-token substitution across repeated runs. This leg reproduces it
on a hosted 4o-mini through a production router carrying real business prompts. Same shape,
different absolute constant, different model family, different serving stack. That is a
replication, not an echo.

## Layer 2 — Synthesis mode (the contextual response call)

**Question:** the middleware finding — synthesis output *tracks the cap / workload* — does the
gradient replicate, and where does it bend?

**On this stack it does not appear at all, and the reason is instructive.**

| cap | n | median | mean | min–max | within-cell range | truncated |
|---|---|---|---|---|---|---|
| 400 | 20 | 127.5 | 126.5 | 95–158 | 63 | 0/20 |
| 800 | 20 | 130.5 | 131.7 | 111–159 | 48 | 0/20 |
| 1600 | 20 | 118.5 | 119.0 | 102–150 | 48 | 0/20 |
| 4096 | 20 | 122.5 | 126.3 | 106–157 | 51 | 0/20 |

The medians move by **12 tokens across a 10× cap range**, and not monotonically
(127.5 → 130.5 → 118.5 → 122.5). The **within-cell** range is 48–63 tokens — four to five times
the between-cap spread. Run-to-run variation dwarfs cap variation, so the cap explains nothing
here. Unlike substitution, synthesis is genuinely non-deterministic: **80 distinct output hashes
out of 80 calls**. It varies freely; it just does not vary *with the cap*.

Median synthesis output is **3% of the 4096 cap**.

**Why the gradient is missing — measured, not guessed (v1.1.0):** the shipped response prompt
contains the instruction `2-4 sentences.`, the natural suspect. The v1.1.0 arm deleted exactly
that sentence from the frozen payload (a byte-verified 15-byte change) and re-ran the full
synthesis grid alongside a same-day fresh control (not the first sweep re-reported; its centre,
124–128.5, sits inside the first sweep's 118.5–130.5 span without reaching its lowest cells):
per-cap medians 124–128.5 with the instruction, 133.5–144.5 without — pooled **127 → 138.5
(1.09×)**, zero truncations, maximum 174 tokens against a 4096 cap. The shift is real — about 4×
the standard error of the paired difference, and all four instruction-removed cells sit above all
four control cells (a pattern an inert cause produces ~1 time in 16) — and it is bounded:
removing the instruction lengthens the reply by ~9% and no more. **The instruction is a
contributor, not the binding constraint; the order-of-magnitude gap to every cap is governed by
the model's natural answer length**, which for a short sales turn floors near ~130 tokens.
Whether the absence of a reasoning trace is what places that floor is the middleware leg's axis;
it was not varied on this stack.
Data, byte-verified variant payload and replay commands: [`instruction-off/`](instruction-off/).

This does not contradict the middleware leg — it bounds it. **The workload gradient is a property
of synthesis calls allowed to run to their natural stop; on a no-trace hosted model behind a
production prompt, the natural stop itself sits an order of magnitude below every cap.** A
production sales reply is length-instructed by construction, because merchants want short
replies — and the instruction trims about 9% from where the model would stop on its own.

## Layer 3 — Production confounders (the leg only this stack can claim)

Fixture sweeps see the model through clean inputs. A production router does not: the same two
calls are wrapped in persona, tone, store policies, a sales-mode block, a dialect guide, grounding
rules and a negotiation contract. Two consequences fell out of this run.

### 3.1 The shipped caps are correctly sized — with less headroom than they look

| call shape | shipped cap | completions above it | max observed | headroom |
|---|---|---|---|---|
| substitution | 160 | **0/80** | 49 | 3.3× |
| synthesis | 200 | **0/80** | 159 | 1.26× |

Nothing truncates: `finish_reason` is `stop` on **160/160** calls. But the synthesis maximum of
159 tokens sits inside 21% of its shipped 200-token cap, on a *three-product* result with no
negotiation blocks attached. Those blocks are added on haggling turns, and a larger catalog
returns four product lines instead of three. The cap is not binding today; the margin is thinner
than the cap value suggests. The v1.1.0 instruction-removed arm sharpens the point: without the
length instruction the synthesis maximum reaches **174 tokens — 87% of the shipped cap** — so
the instruction is part of the cap's effective margin.

### 3.2 The deployment's language configuration silently disables a downstream guard

This was not what the sweep was run to measure. It is what the 80 benign synthesis replies happen
to contain, and it cost nothing extra to check. `check-numerals.mjs` re-derives every number below
from the published raw data, with no application source involved.

The fixture customer message contains **no digits at all, in any numeral system**. The retrieved
product lines handed to the model print prices in ASCII (`₪200`), as the application always does.

| | count |
|---|---|
| replies containing Arabic-Indic digits ٠-٩ | **80/80 (100%)** |
| replies containing ASCII digits only | 0/80 |
| replies quoting a catalog price (any numeral system) | 80/80 |
| ...readable by an ASCII-only price extractor | **0/80** |

```
عندنا قميص كتان صيفي بسعر ٢٠٠ شيكل، متوفر بألوان أبيض، بيج، وأزرق فاتح
عندنا قميص كتان صيفي بسعر ٢٠٠₪. متوفر بألوان أبيض، بيج، وأزرق فاتح
```

The application's price extractor is ASCII-only — its regex uses `\d`, which in JavaScript matches
`[0-9]` and nothing else — and its own source comment records the assumption that makes that safe:

> Arabic-Indic digits ٠-٩ are intentionally not converted; they appear in Arabic text but the
> model emits ASCII digits in our flows.

On 100% of these turns that assumption does not hold, so every guard consuming the extractor —
floor enforcement, invented-price detection, underquote detection — receives an empty list for a
reply that visibly quotes prices. The second example compounds it: `٢٠٠₪` is also
number-then-symbol, an ordering the regex does not accept even in ASCII.

Three things make this a Layer-3 finding rather than a bug report:

1. **No attacker, no numeral cue.** The model produced Arabic-Indic digits *spontaneously*, with
   an ASCII-priced context pulling the other way. The trigger is the deployment configuration —
   the store's language setting — not the customer.
2. **A fixture sweep could not have seen it.** The clean-input protocols this record joins never
   put a business-language configuration between the prompt and the model.
3. **It is invisible from the outside.** The replies are correct and well-priced. Only the guard's
   input differs, and a guard logs nothing when it has nothing to work on.

A separate record treats this failure class directly, under adversarial conditions. Here it is
reported as what it was: an unlooked-for result of a cap sweep, on a different store, a different
message, and no adversary.

---

## Deviations from the prior protocols in this chain

Nothing silent. Five, all deliberate:

1. **Temperature pinned to 0.2** to match the two prior legs. The application passes no
   `temperature` at all on either call, i.e. runs at the provider default. The substitution
   determinism in Layer 1 is therefore a T=0.2 result, not a claim about the deployment.
2. **Caps swept 400 / 800 / 1600 / 4096**; the application ships 160 and 200. No cell tests the
   shipped values directly — §3.1 answers that question from the uncapped data instead of spending
   on it.
3. **Synthesis measured on the non-negotiating path.** The application adds pricing-authorization
   and focus-lock blocks on haggling turns. This run measures the shape that ships when a first
   product turn carries no negotiation state — a real production shape, per the engine's own rule
   that such a turn receives no authorization block.
4. **Conversation window of 8 messages**, not the 4 the original design note assumed; the window
   was widened in the shipped router before this run.
5. **Fixture store, not a live database record.** Deliberate, so the record replays without the
   application's database. Its shape mirrors the Arabic production configuration.

## Threats to validity

- **One model, one stack.** These are existence proofs on a production Arabic sales router, not
  universals. The Layer 1 replication is meaningful *because* a different leg found the same shape
  on a different family; the Layer 2 non-result is a statement about length-instructed prompts,
  not about synthesis in general.
- **One fixture message per call shape.** N=20 per cell measures run-to-run variance at fixed
  input, not variance across customer messages. §3.2's 80/80 is 80 runs of one turn and should be
  read as "for this turn shape, total" — not as a traffic-wide rate.
- **Determinism is a T=0.2 artifact.** At the deployment's temperature the single output hash
  would very likely fan out. What survives temperature is the *token count*, not byte equality.
- **§3.1's headroom claim assumes the measured prompt shape.** Adding the negotiation blocks
  lengthens the prompt, not necessarily the completion — untested here.
- **The `finish_reason` evidence is only as good as the provider's reporting**; 160/160 `stop` is
  consistent across every cell, with no contradicting truncation observed in the text.

## Still open

- A second model family on this leg, for a within-stack family split.
- A low-cap arm (50 / 100 / 150) bracketing the shipped values, so the shipped-cap
  conclusion in §3.1 stops being derived and gets measured directly.
- The negotiating synthesis shape, with authorization and focus-lock blocks attached.
- Deeper Layer 3: behavioral dose-response around anchoring and concession, and channel-level
  input findings.
