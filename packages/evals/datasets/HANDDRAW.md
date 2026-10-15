# Hand-drawn check: 10 whiteboards for Kincaid

The grading dataset's whiteboards are generated from handwriting fonts. These ten cases test whether that matters: you copy the same student work by hand, the eval grades both versions, and the report compares accuracy on your copies against the generated ones. A printable copy is in [HANDDRAW.pdf](HANDDRAW.pdf).

## How to draw them

- Use an iPad drawing app in landscape on a white background (closest to the student whiteboard), or paper in a landscape box about 4:3. One case per page.
- Write with a dark pen or the default black or blue ink. Write like a quick student: your normal handwriting, not your neatest.
- Copy the work below line by line, including the mistakes. Small layout differences are fine; the reference image shows roughly where things go.
- Don't add or fix anything. The points on each case depend on exactly this work.
- Save each one as its number: `1.png`, `2.jpg`, … `10.heic` all work. For paper, take the photo straight on, in good light, with the page filling the frame.

When all ten are in one folder:

```bash
pnpm --filter @goblins/evals dataset:add-human ~/Desktop/handdrawn
```

The script scales each image, saves it under `grading/human/`, and links it to the generated case it copies. Running it again replaces earlier copies, so you can add a few at a time.

---

## 1. Angles, problem 1 (correct work)

Problem: angles A and C are supplementary. Angle A is 74°. Find the measure of angle C.

Write:

```
∠A + ∠C = 180°
74 + C = 180
C = 180 − 74
C = 106°        ← draw a loop around this line
```

Expected: 2/2. Case `ar-1-correct`.

## 2. Angles, problem 7 (forgets one x)

Problem: segments AB, DC and EC meet at C. Angle DCE is 148°, and the angles on each side of it are both x. Find x.

Draw, on the right half: a horizontal line, with two rays going down from a point in its middle, one down-left and one down-right. Mark the angle between the two rays with an arc and write 148° under it. Write x° in each of the two narrow angles between a ray and the line.

Write, on the left:

```
x + 148 = 180
x = 180 − 148
x = 32          ← loop around it
```

Expected: 0/2 (one x left out). Case `ar-7-forgot-second-x`.

## 3. Angles, problem 8 (wrong w, carried through)

Problem: line ℓ is perpendicular to line m. The right angle between them is split into 19°, x° and w°. The 138° angle is between m and the line that continues the x/w ray to the lower left. Find x and w.

Draw, on the right: a vertical line labeled l and a horizontal line labeled m crossing it. From the crossing, two rays into the upper-right quarter, making three angles labeled 19°, x°, w° from the vertical going clockwise. Continue the middle ray through the crossing to the lower left, and mark the angle below m between the lower-left ray and the right side of m with an arc, labeled 138°.

Write, on the left:

```
138 = 90 + w
w = 48
19 + x + 48 = 90
67 + x = 90
x = 23
x = 23, w = 48      ← loop around this line
```

Expected: 2/3 (w is wrong, but carried correctly into x). Case `ar-8-w-from-right-angle`.

## 4. Equations, problem 2 (answers only)

Problem: solve 2(x + 5) = 3x + 1, 3y − 4 = 6 − 2y, and 3(n + 2) = 9(6 − n). Explain or show your reasoning.

Write only:

```
x = 9
y = 2
n = 4
```

Expected: 0/3 (the problem asks for work; the rubric gives none for bare answers). Case `sle-2-answer-only`.

## 5. Equations, problem 3 (sign error in the third equation)

Problem: solve (1/9)(2m − 16) = (1/3)(2m + 4), −4(r + 2) = 4(2 − 2r), and 12(5 + 2y) = 4y − (6 − 9y).

Write in two columns. Left column:

```
1/9 (2m − 16) = 1/3 (2m + 4)      ← fractions stacked
2m − 16 = 6m + 12
−28 = 4m      [m = −7]            ← box around m = −7

−4r − 8 = 8 − 8r
4r = 16       [r = 4]             ← box around r = 4
```

Right column:

```
60 + 24y = 4y − 6 − 9y
60 + 24y = −5y − 6
29y = −66
[y = −66/29]                      ← box, fraction stacked
```

Expected: 2/3 (y is wrong: −(6 − 9y) is −6 + 9y). Case `sle-3-sign-error`.

## 6. Equations, problem 6 (right step, then a slip)

Problem: Andre solved −2(3x − 5) = 4(x + 3) + 8 and made a mistake. Where is it, and what is the solution?

Write:

```
Mistake: line 3 to line 4
4x + 6x = 10x, not −2x
10 = 10x + 20
10 + 20 = 10x
30 = 10x
x = 3           ← box
```

Expected: 1/2 (right step, wrong solution; it is x = −1). Case `sle-6-right-step-slip`.

## 7. Linear relationships, problem 3b (graph with the student's own wrong values)

Problem: draw the line for the painting cost (x hours, y dollars) and label the two points from part a. In part a, this student forgot the $500 flat rate and got $1,000 for 20 hours and $2,500 for 50 hours.

Draw, filling most of the page: axes with "hours" along the bottom marked 0, 10, 20, 30, 40, 50, 60, and "cost" up the side marked 500, 1000, 1500, 2000, 2500, 3000. Plot dots at (20, 1000) and (50, 2500) and write "(20, 1000)" and "(50, 2500)" next to them. Draw a straight line from the origin through both dots, up to about x = 60.

Expected: 3/3 (follow-through: right graph for the student's own part-a values). Case `lr-3b-ft-forgot-fee`; the grader also sees the student's generated part-a board.

## 8. Linear relationships, problem 5c (bigger pace is faster)

Problem: Tyler's pace is 8 1/3 minutes per mile and Elena's is 8.5. Who ran faster? Explain.

Write:

```
Elena, because 8.5 is bigger
than 8.33 so her pace is faster
```

Expected: 0/2. Case `lr-5c-bigger-faster`.

## 9. Trigonometry, problem 1a (adds the squares)

Problem: triangle ABC is equilateral with side 8; the altitude is x. Find x.

Draw, on the right: a right triangle with the right angle at the bottom right (small square). Label the slanted side 8, the bottom 4 and the vertical side x.

Write, on the left:

```
x² = 8² + 4²
x² = 64 + 16 = 80
x = √80 = 4√5       ← loop around 4√5
  ≈ 8.94
```

Expected: 1/3 (half-base right; it should be x² + 4² = 8²). Case `rt-1a-added-squares`.

## 10. Trigonometry, problem 2 (carries the wrong height from 9)

Problem: an equilateral triangle has side 8. What is its area? (Same triangle as problem 1.)

Write:

```
same triangle as #1
h = 4√5
A = 1/2 · 8 · 4√5        ← 1/2 stacked
  = 16√5 ≈ 35.8          ← box around 16√5
```

Expected: 2/2 (follow-through on the student's own height from case 9). Case `rt-2-follow-through-root5`.
