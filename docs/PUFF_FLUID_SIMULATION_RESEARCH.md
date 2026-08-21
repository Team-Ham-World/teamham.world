# Puff fluid simulation research

> Historical research. The fluid implementation described here was retired on
> 2026-08-21 in favor of the event-painted ASCII stamp pad. The solver and its
> particle interaction model are no longer part of the application.

## Decision

Replace the cell-swapping liquid with a small **2D Position Based Fluids (PBF)** solver. Keep every non-blank ASCII glyph as one particle, store its glyph/accent as immutable particle metadata, use a bounded uniform neighbor grid, and treat the mouse as a kinematic disk collider that participates in the same contact solve as the hero boundaries.

This is the smallest approach that is both recognizably fluid and robust under direct manipulation. PBF solves a rest-density constraint over each particle's neighborhood, permits a fixed iteration budget, and was designed to retain the stability of Position Based Dynamics at time steps useful for real-time interaction. The original paper explicitly contrasts that with force-based SPH's sensitivity to density errors and small time steps ([Macklin & Müller, 2013, pp. 1–4](https://mmacklin.com/pbf_sig_preprint.pdf)).

The implementation should remain dependency-free TypeScript. The current `CELL_BUDGET` makes 11,500 grid cells the absolute desktop ceiling; the actual particle count is only the non-blank subset. As primary-source feasibility evidence, Müller's own browser JavaScript 2D fluid example preallocates typed-array state for 10,000 particles and uses a uniform spatial hash plus 3×3 neighboring-bin queries ([source: particle/state setup](https://github.com/matthias-research/pages/blob/master/challenges/fluid2d.html#L61-L92), [source: neighbor grid](https://github.com/matthias-research/pages/blob/master/challenges/fluid2d.html#L142-L199)). That is evidence that this scale and data layout are reasonable in browser JavaScript, not a guarantee that this site's DOM rendering and physics will meet 60 fps on every desktop; the implementation still needs an in-repo benchmark at Puff's actual active-particle count.

## Options compared

| Method | Benefits | Problems for this interaction | Decision |
| --- | --- | --- | --- |
| Classic force-based SPH / WCSPH | Direct pressure, viscosity, and surface-tension forces; naturally Lagrangian, so glyph identity stays attached to particles. | Stiff pressure forces impose small stable time steps; free-surface neighbor deficiency and density fluctuations are common failure modes. The classic interactive SPH paper reported interaction with up to 5,000 particles, while the later PBF paper explains why enforcing incompressibility in SPH is still costly and time-step-sensitive ([Müller, Charypar & Gross, 2003](https://diglib.eg.org/items/fb9edf26-94b0-4302-8cfc-52632841cae7); [Macklin & Müller, 2013, pp. 1–2](https://mmacklin.com/pbf_sig_preprint.pdf)). A cursor force layered on top would reintroduce the tuning/explosion problem being removed. | Reject. |
| Verlet/PBD particles with gravity, collisions, and pairwise separation | Minimal state and simple, stable positional collision projection. PBD makes direct manipulation and collision constraints straightforward ([Müller et al., 2006, pp. 1–5](https://matthias-research.github.io/pages/publications/posBasedDyn.pdf)). | Pairwise non-overlap alone behaves like grains or a soft blob. It has no neighborhood rest-density constraint, so it does not enforce liquid incompressibility or transmit pressure coherently. Adding that density constraint is PBF. | Use as the integration/contact framework, not as the fluid model by itself. |
| Position Based Fluids | Rest-density constraint gives coherent pressure; position projection avoids explicit stiff pressure forces; fixed iteration counts give predictable work; collisions belong inside the constraint loop. The paper reports stability with larger steps than PCISPH and normally uses a fixed 2–4 iterations for real-time budgets ([Macklin & Müller, 2013, Algorithm 1 and §§8–9](https://mmacklin.com/pbf_sig_preprint.pdf)). | More code than the existing cellular automaton and requires neighbor queries. Position methods add numerical damping, so viscosity must stay low and optional vorticity must be conservative. | **Recommend.** |

A grid/FLIP pressure solver is not warranted here. It would add particle↔grid transfer and a global pressure solve while making per-glyph identity and local cursor collision less direct. PBF already matches the visual scale and interaction model.

## Minimal solver design

### State and coordinates

Use continuous hero-local coordinates measured in particle spacings, not ASCII row/column occupancy:

- `Float32Array`: `x`, `y`, `prevX`, `prevY`, `vx`, `vy`, `deltaX`, `deltaY`, `lambda`.
- `Uint16Array` or a compact string table index for the glyph; `Uint8Array` for accent material.
- `Int32Array` for uniform-grid `head`/`next` lists or counting-sort bin offsets.
- Fixed particle radius and smoothing radius `h`; fixed mass and rest density for all glyph particles.

The PBF density constraint is one constraint per particle, `C_i = rho_i / rho_0 - 1`, with density estimated from nearby particles using a smoothing kernel. The paper uses Poly6 for density and the Spiky kernel gradient for corrections ([Macklin & Müller, 2013, §3](https://mmacklin.com/pbf_sig_preprint.pdf)). For this stylized 2D solver, use the normalized 2D forms, as Müller's browser reference does ([2D kernel and rest-density setup](https://github.com/matthias-research/pages/blob/master/challenges/fluid2d.html#L61-L92)).

### Fixed simulation loop

Run physics from `requestAnimationFrame` with a fixed-step accumulator; do not make the simulation time step equal the variable render interval or pointer-event frequency.

Start with:

1. 60 Hz physics, split into two `1/120 s` substeps.
2. One density projection per substep; add a second only if the measured density error is visibly too high.
3. At most two catch-up physics frames after a stall, then discard excess accumulated time so returning to the tab cannot inject a giant step.
4. Rebuild/query the bounded uniform grid each substep; inspect only the 3×3 neighboring bins.
5. Keep ASCII text reconstruction/DOM writes at the existing lower visual cadence if needed; physics and text rendering do not need the same rate.

Smaller substeps with one constraint solve have been shown to reduce constraint error and numerical damping more effectively than one large step with the same number of solver iterations, including for position-based fluids ([Macklin et al., 2019, abstract and Fig. 2](https://matthias-research.github.io/pages/publications/smallsteps.pdf)). This is a starting configuration, not a magic constant: record density error and p95 step time before increasing iterations.

Per substep:

1. Apply gravity to velocity.
2. Save prior positions; predict `p* = p + dt * v`.
3. Build the uniform neighbor grid from predicted positions.
4. Generate contacts and pre-stabilize any initial overlap by applying the same contact correction to both original and predicted positions.
5. Compute density constraint multipliers.
6. Compute Jacobi position corrections into `deltaX/deltaY`.
7. Project hero-wall and mouse collision constraints; apply the density and contact corrections.
8. Derive velocity from corrected displacement, `v = (p* - p_old) / dt`.
9. Apply very low XSPH viscosity; start near the paper's `c = 0.01` and omit vorticity confinement initially ([Macklin & Müller, 2013, §5](https://mmacklin.com/pbf_sig_preprint.pdf)).

Use the PBF artificial-pressure anti-clumping term only if testing shows tensile clumping. It is explicitly described as a non-physical tradeoff that also creates a surface-tension-like effect, so it should be small and covered by a regression test rather than used as a general motion boost ([Macklin & Müller, 2013, §4](https://mmacklin.com/pbf_sig_preprint.pdf)).

## Mouse as a moving collision object

The current `stirAsciiLiquid` maps raw pointer deltas into a global upward relocation. That is not collision response: it discards contact geometry, applies energy to non-contacting material, and makes event rate and cell dimensions part of the force law.

Model the cursor as an infinite-mass **kinematic disk** with radius about 2.5 particle spacings:

1. Store the latest pointer position as a target in continuous hero coordinates.
2. At each fixed substep, advance the collider from its previous physics position toward that target. Derive collider velocity from those physics positions, not from `PointerEvent.movementX/Y`.
3. Cap collider displacement per substep (start at one particle radius) and sweep the disk from old to new center. On pointer entry/re-entry, initialize old and new centers identically so there is no teleport impulse.
4. For each particle intersecting the swept disk, create the inequality contact `C = distance(p, center) - (mouseRadius + particleRadius) >= 0` and project only that particle along the local contact normal. PBD supports both continuous ray/sweep contacts and a static closest-surface fallback ([Müller et al., 2006, §3.4](https://matthias-research.github.io/pages/publications/posBasedDyn.pdf)).
5. Resolve contact during each density solve, but transfer collider velocity once after final corrected positions. Enforce non-penetrating relative normal velocity, `dot(v_particle - v_mouse, n) >= 0`; use zero restitution and low tangential friction. PBD's collision model likewise applies friction/restitution in the post-projection velocity update ([Müller et al., 2006, §3.4](https://matthias-research.github.io/pages/publications/posBasedDyn.pdf)).
6. Do not add a separate upward splash multiplier. An upward cursor produces upward momentum only where its disk contacts particles, and each particle's direction comes from its own contact normal.

The primary guard against cursor-induced popping is a **contact pre-stabilization pass**. Macklin et al. describe this precise case: user input moves a kinematic object into an invalid overlap, projection moves the particle out, and deriving velocity from that correction adds kinetic energy that makes the particle continue upward and “pop”; the error gets worse as `dt` decreases. Their remedy is to solve contacts against the original positions and apply the same deltas to both original and predicted positions before the main solver, so overlap repair does not become velocity. They report that 1–2 contact-only stabilization iterations usually remove the visible artifact ([Macklin et al., 2014, §4.4 and Algorithm 1](https://matthias-research.github.io/pages/publications/flex.pdf)). Actual mouse momentum should then be applied once through the collider-relative velocity rule above.

As a second guard, cap contact de-penetration speed. The later `Small Steps` paper formalizes the same failure: correcting an initial overlap over one short substep creates separating velocity `v_sep = depth / dt`, which grows as `dt` shrinks. It recommends limiting maximum separating speed in the contact constraint; large limits allow explosive separation, while small limits separate gently ([Macklin et al., 2019, §4.3](https://matthias-research.github.io/pages/publications/smallsteps.pdf)). Apply that cap to mouse contacts and walls. Together, pre-stabilization and the speed cap prevent a smooth upward stroke from turning penetration depth into a tall jet.

## Performance plan

The uniform grid changes neighbor finding from all-pairs work to local queries. With bounded occupancy, work is approximately `O(N * k * iterations)`, where `k` is the local neighbor count, instead of `O(N²)`. PBF itself amortizes neighbor finding across density iterations, and its profiling identifies neighbor detection and the constraint solve as the main costs ([Macklin & Müller, 2013, §§6, 8](https://mmacklin.com/pbf_sig_preprint.pdf)).

For this bounded hero, a direct grid is preferable to a general hash table: calculate integer bin coordinates, use one `head` per hero bin and one `next` per particle, and inspect nine bins. Keep all hot state in typed arrays, avoid per-frame objects/arrays, and reuse text-row buffers.

Acceptance budget:

- Benchmark the exact non-blank Puff particle count, not the 11,500-cell ceiling.
- p95 physics time below 8 ms on the project's desktop reference machine, leaving time for string reconstruction, DOM writes, and the rest of the page.
- No unbounded catch-up loop; no allocation proportional to particles inside the steady-state step.
- If the budget misses, first reduce density iterations/substeps or update text less often. Do not scale cursor force to mask a coarse/viscous solve.

## Regression and behavior tests

The solver should be deterministic for fixed inputs and expose pure stepping functions so these can run without a browser:

1. **Frame-rate invariance:** the same pointer path sampled at 30, 60, and 120 events per second produces similar final momentum/height because contact uses physics-time collider motion, not event deltas.
2. **Contact locality:** before pressure propagates through neighbors, only particles intersecting the swept disk receive direct cursor momentum.
3. **Directionality:** a slow upward sweep cannot create more normal particle speed than the collider speed plus the configured de-penetration cap.
4. **No pop from overlap:** initialize the disk slightly inside a settled pool; maximum separating speed remains under the cap documented above.
5. **Non-penetration:** after contact projection, every contacting particle satisfies the disk/wall inequality within tolerance.
6. **Density bound:** track maximum and mean `abs(rho / rho_0 - 1)` after settling and after a pointer sweep.
7. **Identity conservation:** particle count, glyph multiset, and accent count never change.
8. **Containment:** all particles remain inside the hero's fluid bounds and above the “Here's what we're working on” boundary.
9. **Performance:** benchmark one second of worst-case dense-pool interaction at the actual desktop particle count and fail or report when the p95 step exceeds the agreed budget.

## Recommended implementation boundary

Keep the physics in `src/lib/puff/liquid.ts` (or split private math/grid helpers beside it) behind a small interface:

- `createAsciiFluid(glyph frame, hero bounds)`
- `setKinematicPointer(position | inactive)`
- `stepAsciiFluid(fixedDt)`
- `renderAsciiFluid(previous/current positions, interpolation alpha)`

`PuffScene` should translate pointer coordinates and schedule fixed steps; it should not calculate forces. This keeps the collision law testable and prevents browser event semantics from leaking back into fluid behavior.

## Primary sources

- Miles Macklin and Matthias Müller, [*Position Based Fluids*](https://mmacklin.com/pbf_sig_preprint.pdf), ACM Transactions on Graphics 32(4), 2013.
- Matthias Müller et al., [*Position Based Dynamics*](https://matthias-research.github.io/pages/publications/posBasedDyn.pdf), VRIPHYS, 2006/2007 publication version.
- Miles Macklin et al., [*Unified Particle Physics for Real-Time Applications*](https://matthias-research.github.io/pages/publications/flex.pdf), ACM Transactions on Graphics 33(4), 2014.
- Miles Macklin et al., [*Small Steps in Physics Simulation*](https://matthias-research.github.io/pages/publications/smallsteps.pdf), SCA 2019.
- Matthias Müller, David Charypar, and Markus Gross, [*Particle-Based Fluid Simulation for Interactive Applications*](https://diglib.eg.org/items/fb9edf26-94b0-4302-8cfc-52632841cae7), SCA 2003.
- Matthias Müller, [browser JavaScript 2D particle-fluid reference source](https://github.com/matthias-research/pages/blob/master/challenges/fluid2d.html).
