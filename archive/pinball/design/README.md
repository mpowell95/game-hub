# Pinball playfield — engine notes

Files: `board.js` (ES module, `buildBoard(THREE)` → THREE.Group, 123 named meshes, 16 named materials, no assets), `footprints.json` (same data as the module's `FOOTPRINTS` / `TRANSITIONS` exports), `viewer.html` (3D preview + OBJ/GLB download; `?level=1|2`, `?fp=1` overlays footprints), `renders/` (top-down views).

Units: meters, y-up, origin at table center, base at y=0. 2D engine coords = (x, z): +x right, +z toward player. Table 0.52 × 1.05 m. Ball Ø 0.027.
Every footprint coordinate was authored in reference-image pixels and converted with `PX(px,py)` (0.000527 m/px, center 493,995) — also exported if you need to add things.

## Levels (2)

**Level 1 — main playfield, surface y = 0.020, full cabinet length (continues under the deck; 0.038 m clearance).** Under the deck: two thick solid gray arch bands (see *Arch measurements*), plus a saucer decal inside the inner arch. The ramps sit immediately outside the outer band's legs (the leg is the ramp's inner wall). Below: cabinet walls, angled apron edges + drain, shooter lane (divider wall + stop), left lane rail with 3 posts, 2 slingshots (3 posts + 3 faces each; face AC kicks), 2 lower flippers, lower pop bumper (between the flippers, above the drain), 2 big posts + 2 posts near the ramp exits, both ramp rails. 202 footprints — 158 of them are the two arch bands, whose measured variable-width edges are emitted as chains of thin capsules (r 0.001, faces flush with the edge; `solidSide` says which side is material).

**Level 2 — upper deck, surface y = 0.070, top section only, rendered semi-transparent.** Same cabinet walls, top target bank (capsule against top wall), 2 pop bumpers, 10 red posts, 2 diagonal guide rails feeding the upper flippers, 2 upper flippers, V-ledge lip on the deck edge (with the drop hole; L2 only — L1 balls pass beneath the deck), ramp rails, top of the shooter divider. 25 footprints.

Everything else (inserts, wedges, saucers, teardrop decal, floors, ramp surfaces) is decoration — `mesh.userData.collides` is `[]`, and `userData.level` is 1, 2 or 0 (shared structure).

## Transitions (see `TRANSITIONS`)

- **ramp_left** L2 → L1, one-way. Entry: ball on L2 crossing z = Z(640) between x = X(45)…X(129), moving +z. Arrives L1 at PX(105, 935) moving +z. Treat the exit line as a wall for L1 balls moving −z.
- **drop_hole** L2 → L1, one-way. The 0.047 m gap in the V-ledge between the upper flipper tips (x = X(455)…X(545) at z = Z(724)). Arrives L1 at PX(500, 785) moving +z.
- **right_chute** L1 ↔ L2, two-way. One gray chute outside the outer arch's right leg, x = X(866)…X(955) (0.047 m wide), z from Z(640) to Z(1000), rising 0.05 m. Plunger shots crossing z = Z(1000) moving −z climb it and arrive on L2 at PX(910, 630) moving −z; deck balls crossing z = Z(640) moving +z roll down it and arrive on L1 at PX(922, 1000) moving +z, into the shooter lane (a weak plunge rolls back the same way). In the reference the right ramp and the shooter lane are the same strip — there is no wooden divider above y ≈ 900.
- **drain**: L1, z > Z(1880) between x = X(390)…X(600).

## Flippers
Footprints are tapered capsules at rest (rPivot 0.012, rTip 0.007) with `pivot`, `length`, `restAngle`, `sweep` (±50°, tip swings toward −z). Left flippers sweep +, right −.

## Gap rule (Ø 0.027; gaps < 0.020 or > 0.030)
All adjacent-pair gaps were checked: slingshot post → flipper pivot 0.015 (closed), upper flipper tips → drop hole edges 0.006–0.0075 (closed), rail end → pivot ≈0 (closed), ramp rail → exit post 0.013–0.016 (closed), outlane 0.033, lane post → wall 0.033, ramp mouths 0.046/0.08, bumper → flipper tip 0.034 (lower) , between upper bumpers 0.041, ledge → big posts 0.036, hole between flipper tips 0.049. Note the lower pop bumper sits above the drain: the two paths past it to the drain are 0.052 wide.

## Rendering
All materials metalness ≤ 0.3 (steel 0.3 with a bright base color). Lit inserts use emissive.

## Arch measurements (v6)
Reference 987 × 1998 px; playfield width = inner wall to inner wall = 910 px (x 45…955); all fractions are px/910. Leg-end heights are from the top inner wall (y = 40). Check: `renders/overlay-bands-on-ref-v6.png` (model bands at 45 % over the reference) and `compare-ref-vs-L1-v6.png`.

Method. Open playfield (y ≥ 640): per row, 3×5-mean saturation < 0.30 = gray; ramp separated from arch leg by luminance (ramp ≥ 115). Under the semi-transparent deck: 9×9-mean saturation — gray-beneath reads 0.45–0.55 ("6" in the logs), wood-beneath 0.70–0.80 ("9"); edges taken at the 6→9 transition, sampled every 4 px down columns x = 200…736 and across rows y = 300…400. The bands are **not** the same thickness anywhere along their length; the model stores both edges as measured polylines (`OUTER_OUT/OUTER_IN`, `INNER_OUT/INNER_IN` in board.js).

**Outer arch** — a big flattened arch: flat crown, sloping shoulders, legs that taper to a point-ish end.
- Outer edge: flat at y 305–306 from x 350 to 700, then (268,320) (252,340) (244,360) (232,380) (218,400) (200,440) … (129,640) on the left, mirrored (716,320) (732,340) (748,360) (756,380) (764,400) (790,440) … (862,640) on the right. Legs: left 129→186 (y 640→900), right 862→809.
- Inner edge (rounder): (500,414) (470,422) (440,430) (410,438) (380,454) (350,470) (320,486) (290,522) (260,572) (230,620); legs 230→206→224 (left), 772→790→776 (right).
- Thickness: crown 305→414 = 109 px = **0.120**; shoulder x = 290: 310→522 = 212 vertical ≈ 120 normal = **0.13**; shoulder x = 230: 392→620 (in the leg root) ≈ 100 = **0.11**; left leg y 660: 94 = **0.103**, y 700: 80 = **0.088**, y 780: 61 = **0.067**, y 840: 52 = **0.057**, y 900: 34 = **0.037**; right leg y 700: 78 = **0.086**, y 800: 60 = **0.066**, y 840: 53 = **0.058**, y 900: 33 = **0.036**.
- Leg ends: left ≈ 908 → **0.954**; right ≈ 908 → **0.954** (both present at y 900, gone at 920).
- Overall: width 129→866 = 737 px = **0.81**; height 305→908 = 603 px = **0.66**.

**Inner arch** — rounder, also thick at the crown and tapering down the legs.
- Outer edge: (500,488) (470,496) (440,504) (410,512) (380,540) (350,564) (320,600); legs 317→340 (left, y 710→790), 684→664 (right).
- Inner edge: (500,576) (470,580) (440,588) (410,604) (380,616); legs 363→364 (left), 641→640 (right).
- Thickness: crown 488→576 = 88 px = **0.097**; x = 440: 84 = **0.092**; x = 380: 76 = **0.084**; left leg y 710: 46 = **0.051**, y 750: 37 = **0.041**, y 790: 24 = **0.026**; right leg y 710: 43 = **0.047**, y 750: 36 = **0.040**, y 790: 24 = **0.026**.
- Leg ends: both vanish under the big posts at (345,785)/(641,785): left ≈ 796 → **0.831**, right ≈ 796 → **0.831**.
- Overall: width 317→684 = 367 px = **0.40**; height 488→796 = 308 px = **0.34**.

**Gap between the bands (wood):** crown 414→488 = 74 px = **0.081**; x = 440: 430→504 = 74 = **0.081**; x = 380: 454→540 = 86 = **0.095**; x = 320: 486→600 = 114 = **0.125**; legs y 720: left 213→321 = 108 = **0.119**, right 682→789 = 107 = **0.118**. Bands are wider than the gap at the crown (109 / 88 vs 74) and the gap never drops below 0.039 m — no trap range.

**Ramps (separate parts outside the outer legs):** left ramp x 45→129 at y 640 (84 px = **0.092**), widening as the leg tapers, bottom ≈ y 935. Right: the bright strip x 862→955 (93 px = **0.102**) runs from the deck edge into the shooter lane (no divider above y ≈ 900) — modelled as one two-way chute.
