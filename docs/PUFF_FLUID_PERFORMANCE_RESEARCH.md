# Puff fluid performance research

> Historical research. The fluid implementation described here was retired on
> 2026-08-21 in favor of the event-painted ASCII stamp pad. The solver and its
> GPU/fallback render paths are no longer part of the application.

## Recommendation

Do **not** randomly remove Puff's particles from the existing simulation. The best first optimization is to build one packed neighbor list per step and reuse it for both density passes. That changes data access, not the fluid model: particle count, rest density, gravity, glyph identity, mouse collision, and the 60 Hz step all remain unchanged.

The current benchmark is already enough to explain the recording: about 4,850 particles cost roughly 13.7–14.4 ms at p95 for physics alone. A 60 Hz frame has 16.67 ms for physics, rasterization, two text writes, style/layout, paint, and unrelated page work. The solver is therefore consuming nearly the entire frame before the browser renders it.

The optimization order should be:

1. cache neighbors and their kernel terms;
2. measure the full browser frame and add CSS containment if layout/paint is material;
3. only if needed, add a uniformly coarser liquid quality tier;
4. defer local sleeping, workers, Canvas, and GPU work until those smaller changes are proven insufficient.

## Why naïve culling makes this fluid worse

PBF density is not merely a visual particle count. It is estimated as a sum of the neighboring particles' mass-weighted kernels, `rho_i = sum(m_j W(p_i - p_j, h))`. Puff's solver follows the equal-mass simplification in the original paper. Deleting, for example, every third equal-mass particle while leaving rest density and kernel support unchanged therefore lowers the density estimate and removes pressure support ([Macklin & Müller, equations 1–2](https://mmacklin.com/pbf_sig_preprint.pdf)). Puff also clamps under-density to zero pressure, so naïve removal is especially likely to turn the pool into sparse falling grains rather than faster water.

Proper adaptive sampling is substantially more than culling. Adams et al. merge and split particles while changing mass and support radius, use symmetric mixed-support forces, choose merge locations that avoid large pressure forces, and preserve mass and linear momentum ([physics framework](https://geometry.stanford.edu/paper/apkg-aspf-sig07/apkg-aspf-sig07.pdf), [merge/split rules](https://geometry.stanford.edu/paper/apkg-aspf-sig07/apkg-aspf-sig07.pdf)). That is a variable-resolution fluid solver, not a safe one-line particle filter.

There are three distinct meanings of "cull," with different results:

| Change | Physics cost | Fluid density | ASCII result |
| --- | ---: | --- | --- |
| Hide some glyphs only while still simulating them | unchanged | preserved | sparser display; no meaningful speedup in the measured hot path |
| Delete simulation particles in the current grid | lower | broken unless mass, support, and constraints are reformulated | holes, weak pressure, granular flow |
| Rebuild the liquid at a uniformly coarser spatial resolution | lower | can be preserved as a lower-resolution fluid | coarser glyph grain; requires screen-space gravity/collider scaling |

The third option is the only reasonable particle-count quality tier for this site. It should rerender or resample Puff on a coarser, uniform liquid grid rather than delete an irregular subset. Because one coarse simulation cell covers more CSS pixels, gravity and collider dimensions must be converted so their **screen-space** motion stays the same; leaving the existing cell-space constants untouched would change the feel the user already approved.

Simulating fewer carrier particles while still drawing all original glyphs is possible, but it is a separate simulation/render decoupling design: the extra glyphs become passive tracers attached to or interpolated from carriers. It needs a velocity interpolation rule, collision handling for tracers, stable carrier reassignment, and overlap control. It is not the lowest-risk fix for 4,850 particles.

## Ranked, falsifiable optimizations

### 1. Reuse one packed neighbor list and cached kernel data

**Impact:** high. **Complexity:** low to medium. **Physics risk:** low.

`liquid.ts` currently walks the same 3×3 buckets once to calculate every `lambda` and again to calculate every correction. It also repeats radius checks, square roots, and kernel-gradient calculations even though predicted positions do not change between those two passes when `SOLVER_ITERATIONS` is one.

The original PBF algorithm discovers neighborhoods once before the Jacobi iterations, and the authors explicitly report neighbor detection as 28% of their frame while the constraint solve consumes another 38–51% ([algorithm and optimization](https://mmacklin.com/pbf_sig_preprint.pdf), [performance breakdown](https://mmacklin.com/pbf_sig_preprint.pdf)). Müller's browser JavaScript reference uses exactly the useful CPU layout here: a packed `Int32Array` neighbor vector plus `firstNeighbor[i]` offsets, built once and reused by the fluid and viscosity passes ([reference source, `findNeighbors`](https://github.com/matthias-research/pages/blob/master/challenges/fluid2d.html#L1694-L1785), [packed-list consumption](https://github.com/matthias-research/pages/blob/master/challenges/fluid2d.html#L1802-L1933)).

For Puff:

- keep the existing bounded uniform grid for broad-phase lookup;
- add reusable `neighborStarts` and growable typed arrays for neighbor IDs;
- during the one neighbor query, cache density weight and gradient components (or the minimum data needed to avoid the second square root);
- consume that packed list for both `lambda` and correction calculations;
- allocate/grow only when capacity is exceeded, never once per frame.

The PBF paper notes that neighborhoods may safely be reused within a step while distances and constraint values are recomputed after position changes ([section 6](https://mmacklin.com/pbf_sig_preprint.pdf)). Puff currently has one solver iteration, so its predicted positions are identical during the two hot passes and cached kernel terms are valid. If multiple solver iterations return later, kernel terms must be refreshed after each position update even if neighbor IDs are retained.

**Pass condition:** on the same machine and 4,850-particle fixture, after at least 200 warm-up steps and 600 measured steps, physics p95 is at most 10.5 ms, total JavaScript callback p95 is at most 12.5 ms, and the existing one-second free-fall/collider/containment/glyph tests remain unchanged. If neighbor IDs alone do not reach that target, cache the per-neighbor kernel terms before changing the physical model.

### 2. Use compact cell ranges or particle reordering only if the packed list is still hot

**Impact:** medium. **Complexity:** medium. **Physics risk:** low.

The linked-list grid jumps through particle indices in original glyph order. A count/prefix-sum grid produces contiguous cell ranges; fully reordering particle state into cell order improves cache locality further. The Adaptive PBF implementation uses counting-sort neighbor discovery and reports that reordering particles greatly improves memory coherence during density evaluation ([Köster & Krüger, implementation details](https://aircconline.com/ijcga/V6N3/6316ijcga01.pdf)). NVIDIA's primary spatial-subdivision reference likewise stores cell IDs and object IDs in separate arrays, sorts by cell, then traverses identical-cell ranges ([GPU Gems 3, chapter 32](https://developer.nvidia.com/gpugems/gpugems3/part-v-physics-simulation/chapter-32-broad-phase-collision-detection-cuda)).

Start with compact cell ranges plus an index indirection. Reordering every glyph/state array each frame is more invasive and may cost more than it saves at 4,850 particles, so accept it only if a phase benchmark shows neighbor-list construction or position gathers remain dominant.

**Pass condition:** at least a further 10% reduction in median and p95 physics time versus recommendation 1, with no per-frame allocations and no trajectory change beyond documented floating-point-order tolerance.

### 3. Add a uniformly coarser liquid tier, not random particle deletion

**Impact:** high and predictable when enabled. **Complexity:** medium. **Physics risk:** medium.

If recommendation 1 does not leave enough browser headroom, lower the liquid's spatial resolution as a whole. A linear cell-size increase of `s` reduces the available 2D cell count by approximately `1 / s²`; the exact nonblank-particle reduction must be measured from a rerendered Puff. Keep the surface and pointer neighborhood at the same uniform resolution—adaptive interiors are not useful for this shallow ASCII pool and would require variable mass/support.

Convert all screen-coupled values explicitly:

- gravity in liquid-cell units so pixels per second squared remain unchanged;
- collider center, radius, travel speed, and impulse cap;
- particle/raster scale and the two `<pre>` font/line-height values.

**Pass condition:** choose the smallest tier that holds total callback p95 below 12.5 ms on the target desktop, preserves the approved one-second screen-space fall distance within 5%, and has no visible holes in a 10-second mouse-interaction capture. Keep accent particles when selecting/generating the coarse source.

### 4. Isolate text layout and measure presentation time

**Impact:** low to medium. **Complexity:** low. **Physics risk:** none.

The Node benchmark excludes the browser work caused by writing two large `<pre>` strings. `contain: layout paint style` on a correctly fixed-size, overflow-clipped hero subtree tells the browser that internal layout/paint does not affect the rest of the page; CSS Containment exists specifically to bound those calculations ([CSS Containment Level 2](https://www.w3.org/TR/css-contain-2/)). Verify the containing block behavior because layout containment changes containing-block formation.

Instrument rAF callback duration and successive presentation gaps, not physics alone. Long Animation Frame entries can attribute severe (>50 ms) frames to script versus style/layout, but ordinary 17–30 ms animation misses still require rAF/DevTools measurement ([Long Animation Frames API](https://www.w3.org/TR/long-animation-frames/), [timing fields and limitations](https://developer.mozilla.org/en-US/docs/Web/API/Performance_API/Long_animation_frame_timing)).

**Pass condition:** containment lowers full-frame p95 or style/layout duration by a measurable 5% without changing clipping/positioning. Otherwise remove it; do not keep a speculative CSS optimization.

### 5. Global idle sleep is safe; local particle sleeping is not a first fix

**Impact:** high only after the whole pool settles. **Complexity:** low globally, high locally. **Physics risk:** low globally, high locally.

A global sleep can stop stepping/rasterizing once the collider is inactive and every particle remains under velocity/position-change thresholds for a dwell period, then wake on pointer entry/movement. This reduces idle battery/CPU use but does not improve the initial fall or active mouse interaction shown in the recording.

Local sleeping is harder. Inactive particles still represent fluid mass and must remain in neighbor density sums; active neighbors can otherwise collapse into them. NVIDIA Flex supports active sets but explicitly warns that constraints referencing inactive particles may behave unexpectedly ([Flex active-set manual](https://nvidiagameworks.github.io/FleX/1.2/lib_docs/manual.html#active-set)). A correct local scheme needs support/density criteria, a wake band around the collider, neighbor-to-neighbor wake propagation, and periodic validation.

**Pass condition for global sleep:** zero simulation callbacks after settling, wake in the first pointer frame, and the first five resumed frames satisfy the existing collider impulse bounds.

### 6. Do not stagger the only density solve

**Impact:** tempting but incorrect for this configuration. **Complexity:** low. **Physics risk:** high.

Adaptive PBF reduces the **additional** Jacobi iterations for low-detail particles, but its lowest level still performs one simulation iteration, with active particles continuing to account for inactive neighbors ([Köster & Krüger, sections 4–5](https://aircconline.com/ijcga/V6N3/6316ijcga01.pdf)). Puff already performs one iteration. There is no remaining per-particle iteration to cull.

Similarly, solving pressure at 30 Hz while applying gravity/collision at 60 Hz is not the paper's method and creates alternating density enforcement. The “Small Steps” result points in the opposite direction: for a fixed number of projections, smaller substeps with one solve reduce error and damping better than a large step with repeated iterations ([Macklin et al., 2019](https://matthias-research.github.io/pages/publications/smallsteps.pdf)). Preserve Puff's 60 Hz integration and one density solve unless a measured quality test justifies a different physical model.

### 7. Workers and GPU are escalation paths, not first-line speedups

**Impact:** high main-thread relief; uncertain end-to-end latency. **Complexity:** high. **Physics risk:** low if deterministic, architectural risk high.

A dedicated worker can move physics off the UI thread, but it cannot write the `<pre>` DOM. Standard worker messages clone data; transferable buffers move ownership, while shared memory needs cross-origin isolation ([Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers), [cross-origin isolation](https://developer.mozilla.org/en-US/docs/Web/API/WorkerGlobalScope/crossOriginIsolated)). At 60 Hz, use double-buffered transferable state or `SharedArrayBuffer`; copying thousands of positions back every frame can trade compute jank for communication latency.

Moving rendering too requires changing from text DOM to Canvas. `transferControlToOffscreen()` can give a worker control of a canvas ([OffscreenCanvas transfer](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/transferControlToOffscreen)), but preserving crisp two-color ASCII would then require a glyph atlas/batched renderer and accessibility fallback.

WebGPU exposes compute passes and storage buffers and the original PBF stages are parallelizable ([WebGPU specification](https://www.w3.org/TR/webgpu/), [PBF GPU discussion](https://mmacklin.com/pbf_sig_preprint.pdf)). For only 4,850 particles, however, neighbor-grid construction, buffer synchronization/readback, glyph rendering, device setup, and fallback code form a large rewrite. Consider GPU only if the CPU neighbor-cache and uniform quality tier fail on target machines.

## Measurement plan

Use the same deterministic Puff fixture for every candidate:

1. Record particle count, hero columns/rows, browser/device, refresh rate, and build mode.
2. Warm for at least 200 fixed steps; measure at least 600 more.
3. Time integration/collider, grid+neighbor construction, density/correction, raster/row strings, DOM writes, and rAF-to-presentation gaps separately.
4. Report median, p95, p99, worst frame, and percentage of presentation gaps above 20 ms and 33 ms.
5. Run three scenes: initial fall, settled idle, and a repeatable collider sweep through the deepest part of the pool.
6. Reject an optimization if it improves median but worsens p95, changes screen-space gravity, produces surface holes, loses glyph/accent identity unexpectedly, or exceeds existing collider-speed bounds.

The practical target is not merely “under 16.67 ms in Node.” Physics should leave several milliseconds for text/layout/paint and unrelated page work, hence the 10.5 ms physics and 12.5 ms callback p95 gates above.

## Decision

Implement the packed reusable neighbor list first. It attacks the measured hot path using the layout demonstrated by Müller's own browser fluid reference and preserves the approved physics exactly. Treat uniform coarse resolution as the controlled fallback. Do not randomly cull particles, skip alternate pressure frames, increase gravity, or start a worker/GPU rewrite before those two steps are benchmarked.

## Implementation result

The packed pair cache was implemented without changing the 4,860-particle benchmark fixture or any gravity, timestep, density, collider, damping, or speed constant. Across three like-for-like runs, physics median improved from 7.33–7.51 ms to 3.45–3.59 ms and physics p95 improved from 8.62–9.57 ms to 4.58–4.87 ms. The optimized solver therefore clears the 10.5 ms p95 target without particle culling or a coarse quality tier.

A 1,500-carrier tier with velocity-interpolated follower glyphs was implemented and measured at 2.25–2.37 ms physics median and 2.98–3.21 ms physics p95. It was later removed: the followers did not participate in density constraints, so they collapsed into dark stacks at the floor and walls, and the collision-free display raster hid that defect by repeatedly reassigning glyphs to integer cells.

The decisive browser benchmark measured visible displacement rather than rAF count. The snapped renderer redrew at 114 Hz, but moving glyphs jumped 2.83 CSS pixels on average, 2.88 px at p50, and 5.10 px at p95. Switching the displayed state to continuous `previousX/Y -> x/y` interpolation reduced the same figures to 0.93 px average, 1.04 px p50, and 1.16 px p95 with no display-order churn. All glyphs now remain density particles; the follower and occupancy-raster paths are gone.

The production renderer attempts one instanced WebGL2 atlas draw and falls back to continuous Canvas 2D on initialization or context loss. At 1790×1100, DPR 2, and about 4,730 live glyphs, the WebGL2 path sustained 120.8 draws/second with a 10.5 ms p95 interval and no gaps above 20 ms. During a full-depth moving-pointer sweep it sustained 120.0 draws/second with a 10.7 ms p95 and no gaps above 20 ms. Forced WebGL2 unavailability and `WEBGL_lose_context` both switched to the second Canvas without replaying the easter egg or losing the liquid state.

An independent implementation audit then found and closed three tail-latency
risks: delayed callbacks now drop stale solver work instead of executing up to
three density solves synchronously; the Canvas fallback retains deadline
overshoot to average 60 Hz on 144/165 Hz displays; and resize/full-screen
changes reproject the live pool and rebuild its
spatial grid. Mouse contact now uses screen-space cell scales, keeping its
collision disk and momentum transfer isotropic even though glyph cells are not
square.
