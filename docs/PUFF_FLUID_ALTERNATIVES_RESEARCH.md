# Puff fluid alternatives: rendering diagnosis and GPU architecture options

Date: 2026-08-21

> Historical research. The fluid implementation described here was retired on
> 2026-08-21 in favor of the event-painted ASCII stamp pad. The solver and its
> WebGL/Canvas renderers are no longer part of the application.

## Decision summary

The reported 10–15 FPS appearance was primarily a **position-quantization problem, not evidence that the physics was only running at 10–15 FPS**. The solver kept continuous floating-point positions, but the now-removed `rasterizeAsciiFluid()` floored every particle to a character cell and the Canvas renderer interpolated between those snapped cell centers. A glyph moving at 10–15 cells/second therefore had only about 10–15 distinct visible positions each second even if the same image was redrawn 120 times.

The best sequence is:

1. **Render the existing continuous `previousX/Y` and `x/y` positions.** Stop using the occupancy raster as the displayed position source. This is the highest-confidence fix for the recording and does not alter gravity or physics.
2. **If Canvas 2D draw cost is still material, keep the current CPU solver and replace roughly 4,800 Canvas `drawImage()` calls with one WebGL2 instanced glyph draw.** This is the best broadly compatible production architecture.
3. **Prototype an all-particle WebGPU PBF path only as progressive enhancement.** WebGPU is the cleanest way to make all glyphs density particles and keep simulation and rendering resident on the GPU, but in August 2026 it still needs a WebGL2/Canvas fallback.
4. If a genuinely different, more Eulerian liquid is desired, prefer a **particle/grid hybrid (PIC/FLIP/APIC)** over plain Stable Fluids. Pure Stable Fluids fills the entire domain and does not represent Puff's finite free surface without substantial extra machinery.

Do not replace the current effect with a height field, plain Verlet repulsion, or a WebGL2 all-pairs SPH/PBF shader. They either cannot represent the required shape and deep pointer interaction, or add major complexity without addressing the actual visual defect.

## Superseded path and the 10–15 FPS illusion

The path measured during diagnosis was:

- Physics advances at `1 / 60` seconds and stores continuous positions in `x/y` plus the preceding step in `previousX/Y` ([`liquid.ts`](../src/lib/puff/liquid.ts#L1), [`stepAsciiFluid`](../src/lib/puff/liquid.ts#L500)).
- The maximum particle speed is 20 character cells/second ([`liquid.ts`](../src/lib/puff/liquid.ts#L8)).
- `rasterizeAsciiFluid()` applied `Math.floor()` to continuous positions, resolved collisions with one of 13 neighboring integer-cell offsets, and stored only `targetCol + 0.5` / `targetRow + 0.5` for display.
- `drawLiquid()` interpolated `renderPreviousX/Y -> renderX/Y`, which were those snapped values, then performed one atlas `drawImage()` per visible glyph.
- The rAF loop can draw at 120 Hz, but physics and rasterization update at 60 Hz ([`puff-scene.tsx`](../src/components/puff-scene.tsx#L441)).

Let a continuous horizontal coordinate be `x(t)` in character cells and the displayed coordinate be:

```text
q(t) = floor(x(t)) + 0.5
```

`q(t)` does not change until `x(t)` crosses a whole-cell boundary. At a steady speed of `v` cells/second, it can produce at most approximately `v` ordinary cell transitions per second. Thus:

- 10 cells/second reads as about 10 visible position changes/second.
- 15 cells/second reads as about 15 changes/second.
- Even the hard 20-cells/second speed cap ordinarily cannot produce more than about 20 distinct cell positions/second along one axis.

At 120 rAF callbacks, the browser can redraw the same snapped position six to twelve times before the next cell crossing. Interpolating two equal snapped endpoints still produces an equal position. When a cell finally changes, interpolation softens that one-cell jump for one physics interval, but it cannot restore the sub-cell motion discarded by `floor()`. Occupancy conflicts can also change which fallback offset wins, causing abrupt sideways hops unrelated to the continuous trajectory.

This is consistent with the platform model: `requestAnimationFrame()` callback frequency generally follows the display refresh rate, including 120/144 Hz displays, but the callback timestamp must drive actual animation progress ([MDN rAF documentation](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame)). A callback is not proof that newly presented geometry differs from the previous frame.

### Immediate correction

Draw each glyph at:

```text
displayX = previousX + (x - previousX) * alpha
displayY = previousY + (y - previousY) * alpha
alpha = accumulatorMs / fixedStepMs
```

The Canvas specification defines `drawImage()` destination coordinates as numeric destination-rectangle coordinates; it does not require integer coordinates ([WHATWG Canvas 2D `drawImage`](https://html.spec.whatwg.org/multipage/canvas.html#drawing-images)). Keep glyph identity and accent as static per-particle data. If overlap control is visually necessary, use a stable per-particle micro-offset, size/opacity treatment, or a stable depth order. Do not recalculate a free integer cell every physics step.

The occupancy raster can remain as a diagnostic or a one-time layout aid, but it must not be the source of animated screen positions. Every GPU option below has the same requirement: a GPU solver followed by integer-cell snapping will still look quantized.

### Falsifiable validation

Before rewriting physics, record these measurements over a 10-second pointer interaction on the target 120 Hz desktop:

1. rAF interval distribution and complete liquid callback time, not just solver time.
2. Per displayed glyph, the number of distinct **continuous screen positions** and distinct **snapped cell positions** per second.
3. Percentage of active frames where at least 10% of moving glyphs change screen position.
4. Presentation gaps above 12.5 ms, 20 ms, and 33 ms.

The quantization diagnosis is confirmed if continuous positions change near the 60 Hz physics cadence while snapped positions change near 10–20 Hz. The continuous-render change passes if a slow-motion recording shows sub-cell motion between former whole-cell jumps, with the existing one-second fall distance and gravity unchanged.

## Architecture comparison

| Approach | Finite free surface and pooling | Thousands of discrete glyphs | Full-hero pointer collider | August 2026 reach | Complexity / risk | Recommendation |
|---|---|---|---|---|---|---|
| Continuous Canvas 2D + current CPU PBF | Yes, current behavior | Native; one sprite per glyph | Current per-particle circle | Broadest | Low | **Do first** |
| WebGL2 instanced glyph renderer + current CPU PBF | Yes, unchanged | Excellent; one atlas quad instance per glyph | Current CPU collider unchanged | WebGL2 is widely available | Low–medium | **Best production upgrade if Canvas draw is costly** |
| WebGPU compute PBF | Yes; all ~4,800 glyphs can be density particles | Excellent; simulation buffer feeds instanced render | Analytic collider in compute over every particle | Incomplete; fallback required | High | **Best full-GPU prototype** |
| WebGL2 Eulerian Stable Fluids + glyph tracers | No, not by itself; the rectangular domain is continuously filled | Glyphs can be passive tracers | Moving obstacle/force field is feasible | Broad, subject to float-target capabilities | High | Reject as a direct replacement; consider only for a smoke/dye aesthetic |
| WebGL2 transform-feedback or texture PBF/SPH | Yes in principle | Excellent rendering; difficult neighborhood solve | Feasible | Broad WebGL2 | Very high | Poor return versus WebGPU or current CPU solver |
| Particle/grid PIC/FLIP/APIC | Yes; particles track the free surface and grid enforces incompressibility | Excellent; particles are glyph carriers | Strong grid/particle collision model | WebGPU preferred; WebGL2 has extension hazards | Very high | Best different physics, but only after a prototype budget is approved |
| Height-field / shallow-water | Only a single-valued surface | Glyphs would be decorative tracers, not the represented volume | Cannot produce correct interaction throughout a side-view deep pool | Broad | Medium | Reject for this composition |
| Verlet / pair separation / simple PBD | Particles exist, but look granular or gelatinous without density constraints | Yes | Easy | Broad | Low–medium | Reject as a water replacement; adding density returns to PBF-like work |

## Option 1: WebGL2 instanced rendering with the current solver

This option separates the proven CPU physics from the draw backend. It specifically attacks Canvas API/draw overhead without changing gravity, the pointer response, the carrier/tracer model, or liquid tuning.

### Concrete layout and pipeline

Use one static quad (two triangles) and one instance per glyph:

```text
Dynamic instance data, updated once per 60 Hz physics step:
  previousPosition: float32x2
  currentPosition:  float32x2

Static instance data, uploaded once:
  glyphIndex: uint16 or uint32
  accent/flags: uint8 or uint32

Uniforms, updated each display frame:
  interpolationAlpha
  cellSize, heroSize, devicePixelRatio
```

For 4,800 glyphs, the two position pairs are 76,800 bytes per physics upload. The vertex shader linearly interpolates previous/current positions, converts character-cell coordinates to clip space, expands the quad to one glyph cell, and selects atlas UVs from `glyphIndex` and `accent`. The fragment shader samples the existing ink/accent atlas. The whole liquid is rendered with one `drawArraysInstanced()`/`drawElementsInstanced()` call. WebGL2 instanced drawing is a widely available core feature ([MDN `drawArraysInstanced`](https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext/drawArraysInstanced)).

Use the canvas dimensions/viewport as the hard hero bound. The current CPU solver remains authoritative for hero walls and the moving circular pointer collider. No GPU readback is needed.

### Benefits and risks

- Preserves the exact approved fluid behavior and all glyph/accent identities.
- Makes draw-call count independent of glyph count at the JavaScript API level.
- Gives continuous sub-cell placement and display-rate interpolation in the vertex shader.
- WebGL2 has been baseline/widely available across current browser engines since 2021 and is also available in workers ([MDN WebGL2](https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext)).
- Main risks are atlas filtering/edge bleed, context restoration, and maintaining a Canvas fallback—not fluid correctness.

Adopt this only if profiling after the continuous Canvas fix shows that the Canvas draw phase or main-thread presentation is still the bottleneck. Require at least a 30% reduction in liquid draw CPU p95 and no visual or trajectory change beyond sub-pixel placement.

## Option 2: WebGPU compute PBF with GPU-resident glyph rendering

This is the most direct full-GPU translation of the current physical model. Position-Based Fluids expresses one density constraint per particle and was designed so its stages can run in parallel; the authors' CUDA implementation performs neighbor finding, collision, and constraint stages on the GPU ([Macklin & Müller, Position Based Fluids](https://mmacklin.com/pbf_sig_preprint.pdf)). The paper also warns that neighbor construction and constraint solving are substantial portions of the frame, so a GPU implementation still needs a real spatial index rather than an all-pairs loop.

### Concrete data layout

One practical WGSL storage representation is 32 bytes per particle:

```wgsl
struct Particle {
  position: vec2f,
  previous: vec2f,
  velocity: vec2f,
  glyph: u32,
  flags: u32,
}
```

Additional storage buffers:

```text
particlesA / particlesB    ping-pong particle state
predicted                  predicted position, or fold into the output state
cellCounts                 atomic<u32> per uniform-grid cell
cellOffsets                exclusive prefix-sum result
cellWriteCursors           atomic<u32> scatter cursors
cellEntries                compact particle IDs sorted/grouped by cell
lambda                     one float per particle
delta                      one vec2f correction per particle
simulation uniforms        dt, gravity, bounds, kernel, pointer state/target
```

WGSL's core atomic type is restricted to `atomic<i32>` and `atomic<u32>` ([WGSL atomic types](https://gpuweb.github.io/gpuweb/wgsl/#atomic-types)). That is enough for grid counts/cursors. It is not a portable basis for float momentum accumulation, so the PBF gather formulation is especially convenient: each particle reads its 3×3 neighboring cell ranges and writes only its own lambda/correction.

### Compute and render passes

1. Integrate velocity with the existing gravity and damping; predict position; apply hero-wall and analytic pointer-circle collision.
2. Clear cell counts, count particle cell keys, exclusive-scan counts, then scatter particle IDs into `cellEntries`.
3. For every particle, gather neighbors from 3×3 cells and calculate density/lambda.
4. For every particle, gather the same neighbors and write its own position correction.
5. Apply corrections and collision; repeat the constraint passes for the chosen fixed iteration count.
6. Finalize velocity from corrected displacement and store current/previous positions.
7. Render an instanced atlas quad for each particle from the same GPU-resident state, interpolating previous/current positions with a uniform alpha. Do not read positions back to JavaScript.

The official WebGPU Compute Boids sample demonstrates the relevant residency pattern: ping-pong storage buffers are updated in a compute pass and the resulting particle buffer is used for instanced rendering ([live sample](https://webgpu.github.io/webgpu-samples/?sample=computeBoids), [official sample repository](https://github.com/webgpu/webgpu-samples)). Puff needs a spatial binning and multi-pass constraint layer on top of that pattern.

A fixed-capacity array per cell is simpler than prefix-sum/scatter, but it needs an overflow counter and a tested failure behavior; silently dropping overflowed particles creates density holes. Prefix-sum/scatter is the robust production design.

### Benefits and risks

- All ~4,800 glyphs can be true density particles, eliminating the carrier/tracer approximation while preserving each glyph's identity.
- Pointer collision runs over every particle throughout the hero, and all simulation/render state stays on the GPU.
- It is a major rewrite: compute synchronization, scans/binning, WGSL alignment, device loss, numerical parity, and a complete fallback must be tested.
- At this particle count, dispatch and pass overhead may be more important than arithmetic. Do not promise a frame rate from papers or native CUDA results; measure the web implementation.

Prototype behind a feature flag. Success requires the same gravity/fall-distance and collider invariants as the CPU oracle, no dropped bin entries, and supported-device compute+render p95 comfortably below the 8.33 ms 120 Hz display budget. Use WebGPU timestamp queries when supported, but also measure end-to-end presentation.

## Option 3: WebGL2 grid/Eulerian Stable Fluids

Stam's Stable Fluids method uses semi-Lagrangian advection and implicit/projection solves so large time steps remain stable, at the cost of numerical dissipation ([Stam, Stable Fluids](https://graphics.stanford.edu/courses/cs468-05-fall/Papers/p121-stam.pdf)). The classic GPU mapping stores velocity, pressure, divergence, and dye fields in textures and runs full-screen fragment passes for advection, forces, pressure projection, and boundaries ([Harris, GPU Gems Chapter 38](https://developer.nvidia.com/gpugems/gpugems/part-vi-beyond-triangles/chapter-38-fast-fluid-dynamics-simulation-gpu)).

### Concrete WebGL2 pipeline

```text
Ping-pong RG float/half-float textures: velocity
Ping-pong R float/half-float textures: dye or occupancy
R texture: divergence
Ping-pong R textures: pressure
Static/updated obstacle representation: analytic pointer circle or mask/SDF
Transform-feedback buffers: glyph tracer previous/current positions
```

Per physics step:

1. Add gravity/interaction forces and moving-obstacle velocity.
2. Semi-Lagrangian advect velocity.
3. Compute divergence.
4. Run a fixed number of Jacobi pressure passes.
5. Subtract pressure gradient and enforce hero/pointer boundary velocities.
6. Advect glyph tracers by sampling the velocity texture in transform feedback.
7. Draw continuous tracer positions as instanced atlas quads.

This makes cost mainly a function of grid resolution and pressure iterations, not glyph count, and deep pointer interaction is natural because the obstacle/force is evaluated across the whole grid.

### Fundamental mismatch

The reference GPU implementation explicitly simulates a continuous fluid filling a rectangular 2D domain and does **not** simulate a free surface between water and air ([GPU Gems scope and free-surface limitation](https://developer.nvidia.com/gpugems/gpugems/part-vi-beyond-triangles/chapter-38-fast-fluid-dynamics-simulation-gpu#383-simulation)). Dye can show Puff-shaped color, but the surrounding domain is still fluid. Gravity therefore does not make a finite Puff body fall, splash, and pool the way the current particle liquid does.

Adding marker particles, a level set/volume fraction, air cells, and free-surface pressure boundary conditions turns this into a substantially larger free-surface solver. A particle/grid hybrid is a better-established route for this requirement.

Float/half-float render-target capabilities must be feature-tested. A PIC-style particle-to-grid splat commonly relies on additive blending into floating-point buffers, while `EXT_float_blend` is not baseline and is independent of float color-buffer support ([Khronos extension specification](https://registry.khronos.org/webgl/extensions/EXT_float_blend/), [MDN compatibility warning](https://developer.mozilla.org/en-US/docs/Web/API/EXT_float_blend)). Pure texture-grid Stable Fluids can avoid particle splats, but then it retains the free-surface mismatch.

Verdict: do not choose this as a faithful Puff-water replacement. It is a good alternative only if the visual direction changes to ink, smoke, or dye flowing through the whole hero.

## Option 4: WebGL2 transform-feedback or texture PBF/SPH

WebGL2 transform feedback captures vertex-shader outputs into buffers before rasterization, allowing ping-pong particle integration entirely on the GPU ([WebGL 2 specification, transform feedback](https://registry.khronos.org/webgl/specs/latest/2.0/#3.7.15)). It works well for independent integration, pointer collision, and tracer advection. Rendering the result as instanced atlas quads is straightforward.

The density solve is the problem. WebGL2 has no general compute shader, shader storage buffer, or portable atomic scatter. A complete PBF/SPH implementation must choose among:

- **All pairs:** each particle samples all other positions from a texture. At 4,800 particles this is 23,040,000 pair checks per pass before multiple density/correction passes.
- **CPU-built neighbors:** JavaScript builds the spatial hash and uploads a compact neighbor table each step. This retains much of the current solver work and adds synchronization/upload complexity.
- **GPU sorting/binning in render/texture passes:** feasible with sorting networks or multi-pass key textures, but far more code and harder validation than WebGPU compute.

Explicit SPH is not an automatic performance shortcut. The PBF paper demonstrates why larger stable time steps can amortize grid construction and neighbor finding, whereas conventional SPH variants often require smaller substeps ([PBF results and discussion](https://mmacklin.com/pbf_sig_preprint.pdf)).

Verdict: use WebGL2 for rendering, not as the preferred full PBF/SPH compute platform. If full GPU physics is required, WebGPU plus a WebGL2/CPU fallback is simpler and more maintainable than a WebGL2 GPGPU emulation.

## Option 5: particle/grid PIC, FLIP, or APIC

This family is the strongest substantially different physical model for the desired effect. Zhu and Bridson's particle/grid method uses a particle cloud for advection and free-surface tracking while an auxiliary grid enforces boundaries and incompressibility ([Animating Sand as a Fluid, fluid method abstract](https://www.cs.ubc.ca/~rbridson/docs/zhu-siggraph05-sandfluid.pdf)). That division maps directly to Puff:

- Every ASCII glyph remains a Lagrangian particle, preserving identity and free-surface topology.
- A grid pressure solve produces coherent incompressible bulk flow.
- Hero walls and the moving pointer are grid boundary/collision objects.
- Particle positions feed the same instanced atlas renderer.

PIC is stable but dissipative; FLIP reduces dissipation but can become noisy. APIC augments each particle with a local affine velocity representation to retain PIC stability while reducing dissipation/noise and conserving angular momentum across transfers ([Jiang et al., The Affine Particle-In-Cell Method](https://www.disneyanimation.com/publications/the-affine-particle-in-cell-method/)).

### GPU mapping

On WebGPU:

1. Bin particles into grid cells with integer atomic counts and prefix-sum/scatter.
2. Have one invocation per grid cell gather its binned particles to build mass/momentum, avoiding unavailable core float atomics.
3. Apply gravity and analytic hero/pointer boundary velocity.
4. Compute divergence, solve pressure, and project grid velocity.
5. Gather PIC/FLIP/APIC velocity back to each particle, collide/advect, then render glyph instances.

On WebGL2, additive particle-to-grid float splats are tempting, but the limited `EXT_float_blend` support creates a compatibility branch. A per-cell gather requires the same difficult GPU binning discussed above.

Verdict: this is the best candidate if the team wants a different liquid with more coherent bulk motion and accepts an XL-sized WebGPU project. It is not the fastest route to fixing the current recording.

## Simpler methods and why they do not fit

### Height-field / shallow-water

GPU shallow-water solvers can be extremely efficient because they evolve depth and depth-averaged horizontal momentum on a grid; published implementations keep simulation on the GPU and support wet/dry states ([Brodtkorb et al., Efficient shallow water simulations on GPUs](https://www.sciencedirect.com/science/article/pii/S0045793011003185)). But the representation is a single-valued height/depth field. In Puff's side-view hero, it cannot simultaneously represent the falling character, overhangs, detached glyph droplets, deep horizontal displacement, and pointer interaction at arbitrary depths. It could animate the top surface of an already settled pool, not the whole easter egg.

### Verlet, pair separation, and generic PBD

Verlet integration plus wall/circle collision is cheap and robust. Pairwise distance/separation constraints make a cloud that behaves more like grains, foam, or a soft body. Generic Position-Based Dynamics is attractive because direct positional constraints and collision are stable and controllable ([Müller et al., Position Based Dynamics](https://matthias-research.github.io/pages/publications/posBasedDyn.pdf)), but incompressible water requires a density/volume constraint—the part already supplied by PBF.

[Clavet-style double-density relaxation](https://www.ljll.fr/~frey/papers/levelsets/Clavet%20S.%2C%20Particle-based%20viscoelastic%20fluid%20simulation.pdf) is another credible particle liquid, but it still performs neighborhood density and displacement passes and is particularly suited to viscous/viscoelastic materials. It changes the look more than the architecture and offers no clear performance advantage over the already measured current solver.

Verdict: keep these only as deliberate stylized alternatives, not performance substitutes for water.

## Browser compatibility and fallback, August 2026

| Capability | Shipping status relevant to this desktop easter egg | Production implication |
|---|---|---|
| Canvas 2D + rAF | Established across current engines | Universal fallback |
| WebGL2 instancing and transform feedback | WebGL2 is baseline/widely available; transform feedback is core WebGL2 | Best broad GPU-render tier; still feature-test context creation |
| Float render targets / float blending | Extension- and device-dependent; `EXT_float_blend` is not baseline | Do not make WebGL2 PIC splatting the only path |
| WebGPU | HTTPS-only and still marked limited availability/non-Baseline | Progressive enhancement only |

Vendor status explains the WebGPU caveat:

- Chromium shipped WebGPU by default on Windows, macOS, and supported ChromeOS hardware in Chrome 113, later enabling a subset of Android 12+ devices in Chrome 121. Linux rollout began with Intel Gen12+ GPUs in Chrome 144 and expanded afterward ([Chrome 113 announcement](https://developer.chrome.com/blog/webgpu-release), [Chrome 121 Android announcement](https://developer.chrome.com/blog/new-in-webgpu-121), [Chrome 144 Linux rollout](https://developer.chrome.com/blog/new-in-webgpu-144#webgpu_on_linux)).
- Firefox's 141 release notes announced full Windows support; Mozilla's current platform-status page describes the default-on release as version 142. As of Mozilla's August 2026 notes, macOS Apple Silicon is enabled from Firefox 147, while Linux and Intel macOS remain Nightly-only ([Firefox 141 release notes](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/141), [Mozilla experimental-feature status](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Experimental_features#webgpu_api)).
- WebKit shipped WebGPU in Safari 26 for current macOS/iOS/iPadOS/visionOS releases ([WebKit Safari 26 announcement](https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/#webgpu)).
- The cross-browser API documentation still marks WebGPU as limited availability and secure-context-only ([MDN WebGPU](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API)).

Use a three-tier runtime rather than browser-name detection:

1. Attempt `navigator.gpu`, `requestAdapter()`, and `requestDevice()`; use WebGPU only if all succeed and the implementation's required limits are present.
2. Otherwise attempt a WebGL2 instanced renderer with the current CPU solver.
3. Otherwise use continuous-position Canvas 2D.

Any initialization, shader compilation, context/device-loss, or capability failure must fall back without replaying the ten-click trigger or losing the user's current hero state. No tier may change screen-space gravity merely to meet a frame budget.

## Ranked implementation recommendation

### 1. Remove integer-cell display quantization

**Impact:** very high for the reported symptom. **Complexity:** low. **Physics risk:** minimal.

Render `previousX/Y -> x/y`; stop displaying `renderPreviousX/Y -> renderX/Y`. Keep fixed 60 Hz physics and the original gravity. Compare a 10-second continuous-position capture with the supplied recording before any solver rewrite.

### 2. Add WebGL2 instanced glyph rendering only if profiling still shows draw pressure

**Impact:** high if Canvas draw/API cost is material. **Complexity:** low–medium. **Physics risk:** minimal.

Keep CPU PBF and upload previous/current positions once per physics step. Render all glyphs in one instanced atlas draw at every rAF callback. Fall back to Canvas 2D.

### 3. Prototype WebGPU all-particle PBF behind a feature flag

**Impact:** high ceiling, but likely little visible benefit over steps 1–2 at the present particle count. **Complexity:** high. **Compatibility risk:** medium–high.

Use all glyphs as density particles, a compact uniform-grid neighbor list, gather-only density/correction passes, and direct GPU instanced rendering. Retain the WebGL2/current-CPU implementation as the production fallback and as a numerical oracle.

### 4. Consider WebGPU APIC only if the visual goal changes from “make this smooth” to “build a materially different fluid”

**Impact:** potentially best bulk-liquid quality. **Complexity:** very high. **Behavioral risk:** high.

APIC/PIC/FLIP is a better free-surface architecture than pure Stable Fluids, but it should be a separately scoped prototype with video comparison and physics acceptance criteria.

### 5. Do not pursue the remaining alternatives for this effect

- Pure Stable Fluids: wrong free-surface model.
- WebGL2 full PBF/SPH: awkward neighbor construction and poor engineering return.
- Height field: cannot represent the required side-view volume/deep interaction.
- Plain Verlet/PBD separation: granular/gel behavior unless density constraints recreate the current complexity.
- Worker-only migration: can move CPU time, but cannot repair snapped motion and adds state-transfer latency; reconsider only if main-thread profiling shows physics contention after continuous rendering.

The critical conclusion is that **solver throughput and perceived motion cadence are currently decoupled**. Preserve the working physics, remove the lossy integer-cell display transform, and only then decide from measurements whether the renderer or the solver merits a GPU rewrite.

## Prototype outcome

The recommended hybrid was implemented and measured on the full 960×950 CSS-pixel hero at DPR 2:

- The old snapped renderer failed the visual-cadence gate at 2.83 CSS pixels mean movement per update and 5.10 px p95, despite more than 110 canvas draws/second.
- Continuous particle interpolation passed at 0.93 px mean and 1.16 px p95.
- Removing the 1,500-carrier/follower split eliminated follower collapse at the floor and walls; every live glyph is again a density particle.
- The instanced WebGL2 path rendered about 4,730 glyphs at 120.8 draws/second with a 10.5 ms p95 interval and no gaps over 20 ms.
- A five-second full-depth pointer sweep sustained 120.0 draws/second with a 10.7 ms p95 interval and no gaps over 20 ms.
- Forced WebGL2 initialization failure and forced context loss both selected the continuous Canvas 2D fallback while preserving the active liquid state.

The final hardening pass also prevents delayed frames from batching multiple
all-particle solves, schedules the Canvas fallback at a refresh-rate-independent
60 visual updates per second,
rescales the live physics domain when the hero is resized or enters full screen,
and evaluates the mouse collider in isotropic screen space so non-square ASCII
cells cannot amplify vertical input. Runtime `data-puff-liquid-*` diagnostics
expose the selected backend and any fallback reason without changing the UI.

This evidence does not justify a WebGPU solver rewrite. WebGPU PBF remains the escalation path if a materially slower supported desktop fails the all-particle CPU solver budget; the current defect was eliminated without changing gravity or the contact model.
