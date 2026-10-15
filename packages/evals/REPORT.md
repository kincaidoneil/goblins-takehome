# How accurate is the auto-grader with cheap models?

2026-10-15 · AI-quality stream · first eval report

The brief asks how accurate the grader is with cheaper models. On 230 generated student whiteboards across four real worksheets, **Claude Haiku 5.5 gives the score a careful teacher would on 96% of submissions, at $0.00057 per grade**, about half the $0.001 target. It sends 7% of grades to the teacher. Only 7 of the 219 grades scored on points (3%) are wrong without a flag, so a student could lose or gain points with nobody looking. Setup costs another $0.016 per worksheet. A teacher with 130 students grading one 10-problem assignment a week costs **$3.30 a month**.

Every number here comes from [`results/tables.md`](results/tables.md), which `pnpm --filter @goblins/evals eval:tables anthropic/claude-haiku-5.5` rebuilds from the checked-in cache at no cost.

| Task | Model | Result | Cost |
|---|---|---|---|
| Grading a submission | `anthropic/claude-haiku-5.5` | 96% exact score; 13 of 25 ambiguous submissions flagged, 1 false flag in 170 | $0.00057 per grade, 4.5 s median |
| Turning a worksheet into problems | `anthropic/claude-haiku-5.5` | 43 of 43 items found; 41 of 43 answer keys right, and it flagged the 2 it got wrong | $0.007 per worksheet, ~50 s |
| Editing setup by chat | `anthropic/claude-haiku-5.5` | 12 of 12 requests handled, on two runs | $0.002 per message |

## The dataset

The eval-dataset stream built the grading set ([`datasets/`](datasets/README.md)). It holds 230 whiteboards covering all 41 gradable items of the four templates, with 4 to 9 per item. They include correct work, partial credit, common mistakes, messy handwriting, blank and near-blank boards, crossed-out work, diagrams, and follow-through on dependent parts.

Each case fixes the points per line of a reference rubric before any grading model sees it. A separate blind regrade agreed on 223 of 230 cases. Kincaid reviewed the 33 cases a careful teacher might score differently ([`datasets/REVIEW.md`](datasets/REVIEW.md)). Eleven of them hinge on a digit written over another, which nobody can read for sure. Those count only toward the flag numbers, so the score numbers are over the other 219.

The whiteboards are rendered from handwriting fonts, not written by students. Generated handwriting is cleaner than a real student's, and the planned hand-drawn check was dropped for time. **Treat these accuracy numbers as an upper bound for real handwriting.**

## Grading: eight cheap vision models

Every model got the same inputs:
- the problem text and diagram description;
- the answer key, rubric and grading notes;
- the student's whiteboard;
- for a dependent part, the student's earlier whiteboard.

Second prompt (v2), all 230 cases:

| Model | Exact score | Wrong, not flagged | Unusable replies | Cost per grade | Median latency |
|---|---|---|---|---|---|
| `openai/gpt-6-luna` | 93% | 12 | 0 | $0.00046 | 5.5 s |
| `anthropic/claude-haiku-5.5` | 93% | 13 | 0 | $0.00051 | 4.0 s |
| `google/gemini-3.1-flash-lite` | 92% | 15 | 0 | $0.00091 | 1.9 s |
| `google/gemini-3.5-flash-lite` | 91% | 17 | 0 | $0.00134 | 2.0 s |
| `google/gemini-2.5-flash-lite` | 82% | 29 | 0 | $0.00031 | 1.9 s |
| `qwen/qwen3-vl-30b-a3b-instruct` | 76% | 49 | 3 | $0.00048 | 10.1 s |
| `mistralai/mistral-small-2603` | 72% of the few it answered | 7 | 192 | $0.00006 | 2.8 s |
| `openai/gpt-5-nano` (minimal reasoning) | 60% | 39 | 89 | $0.00036 | 3.2 s |

Four models are good enough to ship and four aren't. Mistral and GPT-5 Nano mostly fail to return the reply format, and Qwen and Gemini 2.5 Flash-Lite misread too much.

The third prompt (v3) asks for unclear marks and conflicting answers in their own fields, and code turns either into a flag. The top three on v3:

| Model | Exact score | Flagged | Ambiguous flagged | False flags | Wrong, not flagged | Cost per grade | Latency p50 / p95 |
|---|---|---|---|---|---|---|---|
| `anthropic/claude-haiku-5.5` | 96% | 7% | 13 of 25 | 1 of 170 | 7 | $0.00057 | 4.5 / 8.2 s |
| `openai/gpt-6-luna` | 94% | 3% | 8 of 25 | 0 of 170 | 10 | $0.00048 | 7.1 / 13.4 s |
| `google/gemini-3.1-flash-lite` | 91% | 4% | 9 of 25 | 0 of 170 | 16 | $0.00098 | 1.9 / 3.8 s |

**Why Haiku.** Haiku and Luna are within noise of each other on accuracy. Sending the same 230 requests to Haiku a second time changed the total score on 4% of cases and moved exact agreement from 96% to 94%. Haiku is better where it counts for students:
- It flags half the ambiguous submissions where Luna flags a third.
- It leaves fewer wrong grades unflagged (7 against 10).
- It is faster, which matters for the between-problem transition and for how many calls the queue holds open at once.

Luna is the fallback: 16% cheaper, as accurate on clear work, and on a different provider, so the pipeline can fail over to it.

## What the grader receives, and how it's called

Each change was tested on the same 230 cases:

| Change | Exact score | Cost per grade | Decision |
|---|---|---|---|
| Haiku, one call per submission (shipped) | 96% | $0.00057 | Keep |
| Haiku, one call per rubric line | 91% | $0.00109 | No: worse, 5 false flags against 1, twice the cost and over target |
| Haiku, also sent the worksheet page for diagram problems | 95% | $0.00077 | No: no gain over the text description, 35% more cost |
| Haiku with reasoning on (low effort) | 94% | $0.00050 | No: thinking didn't help |
| Luna with reasoning off / low, against its default | 91% / 92%, against 94% | $0.00036 / $0.00041 | No: cheaper but less accurate |

Prompt changes made the biggest difference:

- **v1 → v2.** Three fixes:
  - Rubric lines went out as `[L1] max 1`, and cheap models copied the brackets into the line id, making 12 of 230 replies unusable. They now go out as plain `L1`, with a schema enum.
  - Grading notes became rules ("a correct answer with no work earns both points"); v1 ignored them.
  - The read must come only from the whiteboard, after one model copied the problem text off a near-empty board.

  Gemini 2.5 Flash-Lite went from 71% to 82% exact, and its unusable replies from 12 to 0.
- **v2 → v3.** The two flag fields doubled the ambiguous cases flagged without adding false flags: Haiku went from 6 to 13 of 25, and Gemini 3.1 Flash-Lite from 3 to 9.

## Where it still goes wrong

These are Haiku's 7 wrong grades that nobody would check. Four undercredit the student and three overcredit.

- **Bare correct answers (2).** In `ar-4-answer-only` and `ar-7-answer-only`, the reason says the grading note gives both points for a correct answer with no work, and then the model gives one. The reason contradicts the score.
- **A valid method the rubric doesn't name (1).** `sle-1-divide-by-3` divides both sides by 3 instead of distributing. Kincaid's review gives that full credit; the grader withheld the method point.
- **A slope from the wrong rate (1).** `lr-3c-total-over-hours` divides total cost by hours (60, not 50), but still explains the meaning correctly for that rate. The rubric gives the meaning point; the grader gave nothing.
- **Follow-through arithmetic (1).** `rt-2-carried-wrong` drops the ½ in the area formula. The reason names the slip but awards full credit.
- **A graph that misses its own points (1).** In `lr-3b-misses-points`, the model saw the plotted points and the line, but not that the line misses them.
- **A step never named (1).** `sle-6-resolved-no-step` re-solves correctly but never says where Andre went wrong. The model gave the explanation point anyway.

Flagging is the weakest part. Twelve of the 25 ambiguous submissions still go unflagged, mostly digits written over each other: the model reads one digit confidently and never sees the second. Its reading is usually the likely one, but the teacher doesn't learn it was a guess.

Two next steps would address most of these. Neither is built:
1. A cheap consistency check: flag when the reason and the points disagree, for example "earns both points" with one point awarded.
2. A "credit equivalent methods" default in the drafted grading notes, which extraction can add.

## Extraction

One call reads every page of a worksheet and returns each gradable item, with lettered parts as their own problems. Each item has text with the shared stem, a description of any figure, a solved answer key, an AP-style rubric and links to the items it depends on. Code scored the output against the hand-checked templates, and each answer-key mismatch was then read by hand.

| Model | Items found | Invented items | Text similarity | Answer keys right (read by hand) | Dependencies linked | Cost per worksheet | Latency |
|---|---|---|---|---|---|---|---|
| `anthropic/claude-haiku-5.5` | 43 / 43 | 0 | 0.99 | 41 / 43 | 4 / 5 | $0.007 | 50 s |
| `openai/gpt-6-luna` | 43 / 43 | 0 | 0.97 | 40 / 43 | 4 / 5 | $0.004 | 45 s |
| `google/gemini-3.8-flash` | 34 / 43 (1 worksheet cut off) | 0 | 0.95 | 31 / 34 | 4 / 5 | $0.049 | 78 s |
| `google/gemini-3.5-flash-lite` | 39 / 43 | 12 | 0.91 | not read | 5 / 5 | $0.013 | 16 s |
| `google/gemini-3.1-flash-lite` | 39 / 43 | 12 | 0.86 | not read | 5 / 5 | $0.006 | 9 s |
| `openai/gpt-5.4-mini` | 25 / 43 | 8 | 0.95 | not read | 0 / 5 | $0.020 | 18 s |

The Gemini Flash-Lite models invent parts 2a, 2b and 2c for a problem that lists three equations without letters. GPT-5.4 Mini doesn't split lettered parts at all. Either is disqualifying, so their keys weren't read.

- **Haiku's two misses** are both on linear-relationships problem 5, which asks students to read a pace off a graph. Haiku reads Tyler's line as 8.4–8.5 minutes per mile, where it is 8⅓, and says the teacher should check the reading. Every model misread this graph; Gemini 3.8 Flash read 7.5 and Luna 8.5. Teachers review answer keys during setup, so the setup screen should show every key prominently, above all for graph problems.
- **The one dependency all models miss** is trigonometry problem 2, which reuses problem 1's triangle without saying so. A teacher fixes it by chat ("problem 2 uses the answer from 1a"), which the chat eval covers.
- **Reasoning effort didn't help extraction.** On the first render of the same pages, low, medium and high effort found the same items with the same or more key errors: Haiku matched 41 keys at default effort and 38 at low, Luna 39 at default and 36–39 with effort set. High effort ran past two minutes on the longest worksheets. That sweep is in `results/tables.md`.

## Chat editing

Twelve teacher requests run against a fixed starting setup, and code checks each result. For example: problem 3 is worth exactly 4 points afterward, nothing else changed, and a missing problem 6 is back after 5 with the right text.

| Model | Passed | Cost per message |
|---|---|---|
| `anthropic/claude-haiku-5.5` | 12 / 12, on two runs | $0.0020 |
| `openai/gpt-6-luna` | 11 / 12 | $0.0015 |
| `google/gemini-3.5-flash-lite` | 10 / 12 | $0.0038 |
| `google/gemini-2.5-flash-lite` | 8 / 12 | $0.0008 |

Edits are typed operations, such as setting a rubric or adding a problem after another. The app applies them all or nothing with `Chat.applyEdits`, which rejects unknown labels and broken dependency links, so a bad reply can't corrupt an assignment. The hardest case was fixing a wrong answer key: models changed the key but left the rubric line that stated the old answer. Putting that rule on the `set_answer_key` operation fixed it.

## Cost at scale

Measured on Haiku: $0.00057 per grade, retries included. That's about 3,100 input tokens (a third of them the whiteboard image) and 530 output tokens, and output is almost half the cost.

| Students | Teachers (130 each) | Grades a month | Model cost a month | Peak grades/s (everyone in one 30-minute test) | Peak tokens/min |
|---|---|---|---|---|---|
| 1,000 | 8 | 43,000 | $25 | 6 | 1.2M |
| 10,000 | 77 | 433,000 | $254 | 56 | 12M |
| 100,000 | 769 | 4.3M | $2,500 | 560 | 120M |
| 1,000,000 | 7,700 | 43M | $25,000 | 5,600 | 1.2B |

What changes at each step:

- **1,000 students.** Nothing. Six grades a second at a 4.5 s median means about 25 calls in flight, well within one provider's default limits.
- **10,000 students.** About 250 calls in flight at the bell. Ask for higher rate limits on the model, and fail over to Luna on rate limits. The queue's concurrency cap protects us either way.
- **100,000 students.** Cost starts to matter: $2,500 a month for a free product. Three savings, none measured yet:
  - Cache the prompt prefix. The system prompt, problem and rubric are the same for every student on a problem: about 1,200 tokens a call, which should cut cost by a fifth.
  - Trim the per-line evidence text, since output is almost half the cost.
  - Send a smaller whiteboard image: 768 × 576 should save about 8%.
- **1,000,000 students.** 1.2 billion tokens a minute if everyone tests at once is beyond any single provider. Real schools spread tests across class periods, which cuts the peak about 6×. Even so, at this scale grading needs several providers behind one router, and contract pricing. Self-hosting an open vision model is the other path, but the open models tested here (Qwen3-VL, Mistral Small) aren't accurate enough yet.

## Spend

The evals and prompt development spent **$4.74** of the shared $20 key, against budgets of $8 for evals and $4 for extraction and prompt development:
- grading evals: $2.79;
- extraction runs, including two page renders and the effort sweep: $1.27;
- chat-editing runs: $0.68.

`cache/spend.jsonl` logs every real call. The eval client stops at `EVAL_BUDGET_USD` (default $6), and the grader's own $20 cap applies on top.

## Reproduce

```bash
pnpm --filter @goblins/evals eval:tables anthropic/claude-haiku-5.5
```

Every response is cached in `cache/`, so this rebuilds `results/tables.md` without a network call. To rerun a comparison, use `eval:grading`, `eval:extraction` or `eval:chat` with model specs (see each script's header). A cache miss fails unless `MODEL_CLIENT=openrouter` is set. `eval:export-calls <model>` writes the logged calls for the mock model's latency profile.

## Not verified

- **Real student handwriting.** Everything above is on generated whiteboards, so it is an upper bound.
- **The grader in the deployed pipeline.** These are direct calls from the harness, not queue deliveries. The load test covers the pipeline, with the mock model.
- **Single samples.** The one repeat run (Haiku) moved exact agreement by 2 points, so differences that small between models mean nothing.
- **The common-mistakes grouping for the report.** `Mistakes.groupMistakes` has unit tests but no eval yet.
