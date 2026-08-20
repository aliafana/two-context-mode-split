# instruction-off — the attribution arm (v1.1.0)

**Question** (raised in review of v1.0.0 by Jiwon Seo): v1.0.0 showed synthesis medians moving
12 tokens over a 10× cap range and attributed the short, cap-indifferent profile to the prompt's
`2-4 sentences.` instruction. But as measured, two causes were confounded: the prompt is
length-instructed *and* gpt-4o-mini emits no reasoning trace — a no-trace model may be floored
near its visible-answer length before any instruction applies. Which is it?

**Design:** two arms, same day, same driver, same frozen payload lineage:

- **control** — the published [`../prompts.json`](../prompts.json), untouched. 4 caps × N=20.
- **no-instruction** — the same bytes minus the single span `"2-4 sentences. "` (15 bytes) in
  the synthesis system message. Built and mechanically verified by
  [`make-variant.mjs`](make-variant.mjs): one occurrence, JSON-valid, deep-equal everywhere
  except that one field. The remaining prompt carries no other explicit length instruction.
  4 caps × N=20.

Model `gpt-4o-mini`, T=0.2, zero-failure rule, `SHAPE=synthesis`. Measured prompt tokens
1,168 → 1,162 — exactly the removed sentence, a built-in check that the variant really ran the
shorter prompt.

**Results** — 160/160 clean, 0 retries. Raw:
[`control-replay-2026-08-19T11-59-57-828Z.json`](control-replay-2026-08-19T11-59-57-828Z.json) ·
[`no-instruction-replay-2026-08-19T12-04-06-633Z.json`](no-instruction-replay-2026-08-19T12-04-06-633Z.json)

| cap | control median (instruction ON) | no-instruction median | Δ |
|---|---|---|---|
| 400 | 124 | 133.5 | +9.5 |
| 800 | 128.5 | 144.5 | +16 |
| 1600 | 126.5 | 137 | +10.5 |
| 4096 | 124.5 | 137 | +12.5 |
| **pooled (80/arm)** | **127** | **138.5** | **+11.5 (1.09×)** |

`finish_reason: stop` 160/160 · truncation 0/160 · distinct outputs 20/20 in every cell ·
within-cell ranges 47–60 tokens in both arms · no-instruction maximum **174 tokens** — 0/80
above even the application's shipped 200-token cap. The control arm is fresh calls, not the
first sweep re-reported: its per-cap medians (124–128.5) sit inside the published v1.0.0 span
(118.5–130.5) without reaching its two lowest cells — a few tokens of centre play that the
same-day pairing absorbs, and no provider drift under the comparison. Bonus: Arabic-Indic digits appear in **80/80 replies of both arms** — the §3.2
numeral-mirroring finding is not an artifact of the length instruction.

**Verdict:** deleting the instruction lengthens replies by ~9% (+11.5 pooled median) — real and
consistent: about 4× the standard error of the paired difference, with all four
instruction-removed cells above all four control cells (an inert cause produces that pattern
~1 time in 16). It is also bounded: 9% and no more, against an order-of-magnitude gap to every
cap. **The instruction is a contributor; the binding constraint is the model's natural answer
length.** Whether the absence of a reasoning trace is what places that floor is the middleware
leg's axis; it was not varied on this stack.

**Scope:** one model, one production prompt, one frozen fixture. The reasoning half of the
separating cell (reasoning mode on/off) is the middleware leg's measurement
([10.5281/zenodo.20363998](https://doi.org/10.5281/zenodo.20363998)), not this record's.

**Replay** (from the repository root):

```bash
OPENAI_API_KEY=sk-... SHAPE=synthesis node replay.mjs
OPENAI_API_KEY=sk-... SHAPE=synthesis PROMPTS=instruction-off/variant-prompts.json node replay.mjs
```
