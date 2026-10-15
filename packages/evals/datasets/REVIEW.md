# Review of the 33 uncertain cases

These 33 cases were marked Unsure: a careful teacher could reasonably score them differently from us. All are now Checked.

"Blind" is the score a separate grader gave from the image and rubric alone, without seeing ours; ≠ marks a disagreement. All seven disagreements in the dataset are on this list.

On 2026-10-15 Kincaid accepted the recommendation for each of the four groups below, and the dataset stream decided the other eight. Each case's `review.note` records the decision.

1. **A deciding digit or sign written over or ambiguous** (11): `ar-1-overwritten-digit`, `ar-4-overwritten-digit`, `ar-8-overwritten-digit`, `sle-2-messy-overwrite`, `sle-4-ambiguous-sign`, `lr-2b-overwrite`, `lr-3c-overwrite`, `lr-7b-overwrite`, `rt-1a-messy-ambiguous`, `rt-1b-overwritten`, `rt-8b-messy-overwrite`. The scores stay as the reading the student's own work points to, but these cases carry `expected.scoreOn: "flag"`: the eval scores only whether the grader flags them. Five of the seven blind disagreements are here.
2. **Two final answers, neither crossed out** (3): `ar-3-two-answers`, `sle-7-two-answers`, `rt-2-two-answers`. The answer point is withheld.
3. **A valid method or form the rubric line does not name** (8): `sle-1-divide-by-3`, `rt-3b-small-squares`, `rt-7-pythagoras`, `lr-5c-mph`, `ar-5-drawings-only`, `lr-7a-recursive`, `lr-5a-compares-time`, `rt-9-unlabeled`. Equivalent work earns credit, and the grader is expected to flag it.
4. **Angles given by measure, or with the wrong vertex letter** (3): `ar-2a-measures-only`, `ar-2b-measures-only`, `ar-2b-wrong-vertex`. Measures count when each appears once in the figure; a misnamed angle does not.

The other eight kept their scores, each for the reason in its note: `ar-5-no-explanation`, `sle-3-checks-only`, `sle-7-crossed-out-thin`, `sle-8-partly-agrees`, `lr-1-per-pizza`, `lr-3c-total-over-hours`, `rt-1a-full-base-zero`, `rt-6-wrong-ratio`.

The table keeps the doubt as it was written before the review.

| Case | Item | Ours | Blind | Doubt before review |
|---|---|---|---|---|
| `ar-1-overwritten-digit` | angle-relationships 1 | 1·1 | 1·1 | Middle digit overwritten: 106 or 116. Chose L2 = 1 because the correct setup above makes 106 the likely reading; a teacher could equally withhold it. Flag is what matters. |
| `ar-2a-measures-only` | angle-relationships 2a | 1·1 | 1·1 | No angle names. The rubric note allows measures when it is clear which angles are meant; 27, 63, 26 and 64 each appear once in the figure, so chose 2/2. A teacher who insists on names would give 0. |
| `ar-2b-measures-only` | angle-relationships 2b | 1 | 1 | Item asks to name angles and the student gives only measures. Any reading of 63, 53, 64 (angles at M or triangle CMG) is a valid set, so chose 1; a teacher who requires names would give 0. |
| `ar-2b-wrong-vertex` | angle-relationships 2b | 0 | 0 | The 64 shows the student meant ∠GMF but wrote ∠MGF. Chose 0 because the named set does not sum to 180 and the item is about naming angles; a lenient teacher may accept the intent. |
| `ar-3-two-answers` | angle-relationships 3 | 1·0 | 1·0 | Two final values for c and neither crossed out; the last thing written is 48. Chose L2 = 0 because the student did not commit to 138; a teacher might take the first correct line. |
| `ar-4-overwritten-digit` | angle-relationships 4 | 1·1 | 1·0 ≠ | Tens digit overwritten: 28 or 38. Chose L2 = 1 because the setup makes 28 the likely reading; a teacher could withhold it. The case is mainly for the flag. |
| `ar-5-no-explanation` | angle-relationships 5 | 0·1·1 | 0·1·1 | Bare answers. Chose L1 = 0 because the student never says the angles are equal or writes x and x, and the problem asks to explain; a teacher might read 'both 90' as using equality. |
| `ar-5-drawings-only` | angle-relationships 5 | 1·1·1 | 0·1·1 ≠ | Only labeled drawings and 'yes'. The equal labels on opposite angles show vertical angles are equal and give 90 and 45, so chose 3/3; a teacher who requires a written explanation could withhold L1. |
| `ar-8-overwritten-digit` | angle-relationships 8 | 1·1·1 | 1·1·0 ≠ | Tens digit of x overwritten: 29 or 39. Chose L3 = 1 because the setup makes 29 the likely reading; a teacher could withhold it. The case is mainly for the flag. |
| `sle-1-divide-by-3` | solving-linear-equations 1 | 1·1 | 0·1 ≠ | L1 describes distributing (3x − 12 = 12x); the student never distributes but divides both sides by 3, an equivalent correct step. Scored 1/1 treating L1 as 'correct first step'. |
| `sle-2-messy-overwrite` | solving-linear-equations 2 | 1·1·1 | 1·1·0 ≠ | The final n is a 4 and a 9 written on top of each other. 12n = 48 points to 4, so L3 is scored 1; a teacher could score it 0 or ask the student. |
| `sle-3-checks-only` | solving-linear-equations 3 | 0·0·0 | 0·0·0 | The rubric gives no credit without supporting work and says the check is not scored. The checks prove each answer is right but do not show how it was found. Scored 0/0/0; a teacher could count the checks as work and give 3/3. |
| `sle-4-ambiguous-sign` | solving-linear-equations 4 | 1·1·1 | 1·1·1 | The mark before the 5 is a tiny stroke that could be a minus, a stray mark or a decimal point. −3c = 15 points to c = −5, so L3 is scored 1; a teacher could read c = 5 and score 0. |
| `sle-7-two-answers` | solving-linear-equations 7 | 1·0 | 1·0 | Two boxed answers with neither crossed out, one of them correct. Scored L2 0 as most teachers would; some might accept the correct one. |
| `sle-7-crossed-out-thin` | solving-linear-equations 7 | 1·1 | 1·1 | The student names the line but not the error itself; the corrected line shows 60 and +9y. Scored L1 1; a strict teacher could want 12 · 5 = 60 or the sign stated in words. |
| `sle-8-partly-agrees` | solving-linear-equations 8 | 1·1 | 1·1 | The student hedges ('kind of') instead of stating disagreement, but concludes the equation has a solution, which contradicts Elena. Scored L1 1; a teacher could want an explicit 'no'. |
| `lr-1-per-pizza` | linear-relationships 1 | 0·0·0 | 0·0·0 | Chose 0/0/0: the student never finds a fee, and 6.4 rounded to "about 6" is not a whole-pizza answer. A teacher could give L3 for solving 80 = 12.50n correctly under their own (fee-less) model. |
| `lr-2b-overwrite` | linear-relationships 2b | 1·1 | 1·1 | The deciding digit of Noah's answer is overwritten (7 or 1). Chose L2 = 1 because the line above sets up 5 × 1.5, which gives 7.5; a teacher reading 1.5 would give 0. |
| `lr-3c-total-over-hours` | linear-relationships 3c | 0·1 | 0·1 | L2 accepts 'their slope' per hour. The student gives a per-hour meaning for 60, which is not the slope of their own line. Chose L2 = 1; a teacher could give 0 because 60 is not a slope of the graph. |
| `lr-3c-overwrite` | linear-relationships 3c | 1·1 | 1·1 | The deciding digit is overwritten: 50 (which 1500/30 gives) or 30 (the run). Chose 1, 1 on the 50 reading; a teacher reading 30 would give 0, 0. |
| `lr-5a-compares-time` | linear-relationships 5a | 1·0·0 | 1·0·0 | The rubric expects distances; this compares times for the same 1.2 miles. Chose 1, 0, 0. A teacher could give L2 for Tyler's 1.2 and an equivalent comparison. |
| `lr-5c-mph` | linear-relationships 5c | 1·1 | 1·1 | L2 describes reasoning about fewer minutes per mile; this converts to mph and compares speeds, which is equivalent. Chose 1, 1; a strict reading of L2 gives 0. |
| `lr-7a-recursive` | linear-relationships 7a | 1·0 | 1·0 | The rubric expects h = 3t + 12; the student gives a correct recursive rule with start 12. Chose L1 = 1, L2 = 0 because no equation in t is written; a teacher could give L2 for using the 12-inch start. |
| `lr-7b-overwrite` | linear-relationships 7b | 1·1 | 1·1 | The answer's second digit is written over: 18 (which 54 ÷ 3 gives) or 16. Chose L2 = 1 on the 18 reading; a teacher reading 16 would give 0. |
| `rt-1a-full-base-zero` | right-triangle-trigonometry 1a | 0·1·0 | 0·1·0 | The note gives L2 for a wrong half-base carried correctly, so L2 = 1. A teacher could withhold it: the student used the full base, not a half, and accepted an impossible height of 0. |
| `rt-1a-messy-ambiguous` | right-triangle-trigonometry 1a | 1·1·1 | 1·1·1 | The tick before the 3 could be a radical (4√3) or a stray mark (43). The visible work leads to 4√3, so chose full credit; a teacher could withhold L3. |
| `rt-1b-overwritten` | right-triangle-trigonometry 1b | 1 | 0 ≠ | Cannot tell which digit was written last. Chose 1 on the guess that the student corrected 90 to 60; a teacher reading 90 would give 0. |
| `rt-2-two-answers` | right-triangle-trigonometry 2 | 1·0 | 0·0 ≠ | Two answers with neither crossed out. Chose L1 = 1 for the 1/2 · b · h line and L2 = 0 because the boxed answer is 55.44; a teacher could take 27.72 as the answer and give 2. |
| `rt-3b-small-squares` | right-triangle-trigonometry 3b | 1·1 | 1·1 | The method is neither side² with 2√2 nor diagonal² ÷ 2, so L1 does not literally apply. It is correct, so chose full credit; a strict reading gives L2 only. |
| `rt-6-wrong-ratio` | right-triangle-trigonometry 6 | 1·0·1 | 1·0·1 | L3 asks for a check by a different method, and the student did one, though it fails and the student does not fix AD. Chose L3 = 1; a teacher could require a check that confirms the answers. |
| `rt-7-pythagoras` | right-triangle-trigonometry 7 | 1·1 | 1·1 | L2 names 9 cos 35° or 9 sin 55°; the Pythagorean route is valid and the problem only asks for an expression. Chose full credit; a strict reading withholds L2. |
| `rt-8b-messy-overwrite` | right-triangle-trigonometry 8b | 1·1 | 1·1 | Each angle has two digits written over each other. The method gives 22.6° and 67.4°, so chose full credit; a teacher who reads 27.6 and 62.4 would give 0. |
| `rt-9-unlabeled` | right-triangle-trigonometry 9 | 1·1 | 1·1 | The rubric scores QP = 2 and RQ = 2√3 and penalizes swapping; this answer names neither leg. Chose full credit because x is the short leg by convention; a teacher could withhold both. |
