# Puff non-fluid easter egg alternatives

Date: 2026-08-21

## Final decision

Use an **ASCII broken copy machine / stamp pad**. On Puff's tenth desktop click,
freeze the current two-color ASCII frame, print three imperfect copies across
the hero, and turn the pointer into a direct stamp preview. Click or drag to
deposit more prints; recycle the oldest after 24. One Canvas2D surface is
painted only on activation, input, or resize, and the live mascot animation loop
stops after activation.

This was selected over every continuously animated alternative because it
keeps the full-hero mouse play and HAM's handmade visual language while doing
no simulation or idle rendering work.

## Earlier analytical-wind recommendation

Retire the fluid model. The best replacement is an **analytical ASCII wind**:
capture Puff's last ASCII frame, keep roughly 1,000–1,400 representative glyphs,
and render them as one WebGL2-instanced atlas draw. Each glyph's position is a
closed-form function of its static start data, an absolute animation timestamp,
and one smoothed pointer uniform. There is no density solve, neighborhood grid,
fixed-step catch-up, dynamic position upload, or particle-to-particle collision.

This preserves the important experience:

- Puff visibly transforms rather than merely disappearing.
- The transformed characters can travel through the entire hero.
- The pointer affects characters at every depth and position in the hero.
- The ASCII glyphs and red accent remain recognizable.
- A missed display frame does not make the effect fall behind; the next frame
  evaluates the correct position for the current timestamp.

Use a **24–32-piece paper-strip shatter** as the non-WebGL fallback and as the
reduced-complexity option if absolute performance certainty matters more than
individual-glyph interaction. It can use only `transform` and `opacity`, with
one parent tilt responding to the mouse.

Do not make the first replacement a magnetic spring cloud. It is far cheaper
than fluid, but it still introduces per-glyph mutable state, integration,
uploads, and frame-time behavior. That is unnecessary when the stated priority
is to stop spending time on simulation.

## Animation is not simulation

The alternatives differ more fundamentally than their visuals suggest.

| Model | Position at the next frame | Work per displayed frame | Missed-frame behavior |
| --- | --- | --- | --- |
| Fluid/PBF | Depends on prior state, neighbor density, constraints, and one or more fixed steps | Approximately `O(N * local-neighbors * iterations)` plus rendering | Must catch up, drop time, or visibly slow |
| Independent stateful particles | Depends only on each glyph's prior position/velocity | `O(N)` CPU updates plus rendering | Needs a bounded `dt`; large gaps can destabilize or jump |
| Analytical glyph animation | `position = f(start, seed, absoluteTime, pointer)` | `O(1)` JavaScript plus `O(N)` independent vertex work on the GPU | Skips directly to the correct current pose |
| Compositor keyframes | Browser interpolates a small set of element transforms | `O(T)` layer compositing for `T` tiles; no author frame loop | Browser timeline remains authoritative |
| Full-screen shader | A fragment is computed independently from texture, time, and pointer | `O(P)` fragment work for `P` backing-store pixels | Skips directly to the current image |

The browser supplies a timestamp to `requestAnimationFrame()` and explicitly
warns authors to calculate progress from that time so animation speed remains
correct on high-refresh displays. The callback normally follows the display
refresh rate and is paused in most hidden tabs ([MDN `requestAnimationFrame`](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame)).
That timing model is a natural fit for an analytical effect and removes the
60 Hz physics clock entirely.

`O(N)` is not synonymous with simulation. Evaluating 1,200 unrelated glyph
curves in a vertex shader is linear, parallel rendering work. Integrating 1,200
spring states in JavaScript is also linear, but it is stateful simulation. The
latter is still inexpensive compared with PBF; it simply is not the minimum
work needed here.

## Ranked alternatives

Scores are relative to this hero, not universal graphics benchmarks. Runtime
cost uses **5 = least likely cost**. Complexity uses **5 = simplest**.

| Rank | Direction | Runtime cost | Visual quality | Mouse interaction | Browser reach | Reduced-motion/fallback | Complexity | Verdict |
| ---: | --- | :---: | :---: | :---: | :---: | :---: | :---: | --- |
| 1 | **Analytical instanced ASCII wind** | 5 | 5 | 4 | 4 | 5 | 3 | Best balance; recommended |
| 2 | **Compositor paper-strip/tile shatter** | 5 | 4 | 3 | 5 | 5 | 5 | Safest and cheapest |
| 3 | **Static ASCII world + pointer scanner** | 5 | 4 | 4 | 4 | 5 | 4 | Strong non-particle concept |
| 4 | **Single-quad warp/glitch shader** | 4 | 4 | 4 | 4 | 5 | 3 | Good if distortion fits the art direction |
| 5 | **Independent ballistic glyph/dust** | 3–4 | 4 | 3 | 5 | 5 | 4 | Fine, but Canvas/CPU work remains |
| 6 | **Magnetic/target-seeking glyph cloud** | 3 | 5 | 5 | 4 | 5 | 2–3 | Richest interaction, unnecessary state |

### Cost notation

- `N` is the number of moving glyphs. Puff currently yields roughly 4,700
  visible fluid glyphs; the non-fluid effect does not need that many.
- `T` is the number of raster strips or tiles; 24–32 is enough for a deliberate
  torn-paper look.
- `P` is the WebGL canvas backing-store pixel count. On a high-DPI full-screen
  hero this can be millions of pixels, so “one quad” is not automatically free.

The WebGL guidance from Mozilla directly supports the proposed architecture:
batch sprites into fewer/larger calls, use a texture atlas, prefer work in the
vertex shader when visually possible, and consider a smaller backing buffer as
a quality/performance trade ([MDN WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)).
WebGL2's `drawArraysInstanced()` renders many instances in one operation and is
widely available; WebGL1 can use `ANGLE_instanced_arrays` as a secondary path
([Khronos WebGL2 specification](https://registry.khronos.org/webgl/specs/latest/2.0/#5.14.11),
[MDN `drawArraysInstanced`](https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext/drawArraysInstanced)).

## 1. Recommended: analytical instanced ASCII wind

### Visual direction

On click ten, Puff briefly compresses, then its outline tears into a gust of
ASCII. The red loop leads the motion like a ribbon. Characters spread across
the full hero in curved streams, slow into a sparse living field, and can
eventually arrange into a large loose `HAM`, a constellation, or a windblown
band. Moving the mouse bends the nearby stream as if the pointer were a fan or
magnetic lens. Nothing pools, splashes, or pretends to be water.

A useful three-beat sequence is:

1. **Recognition, 0–250 ms:** retain a captured Puff snapshot while a small
   scale/squash and two or three horizontal tears signal the transformation.
2. **Release, 250–1,500 ms:** 1,000–1,400 selected glyphs travel on seeded
   curves from their source cells to destinations distributed over the hero.
3. **Play, after 1,500 ms:** glyphs drift on small periodic paths around their
   destinations; the pointer displaces nearby glyphs with a bounded radial or
   tangential field.

The temporary source snapshot prevents the lower glyph count from making Puff
look perforated at the instant of transformation. Stratified selection—at most
one or two glyphs per small source block, always retaining the red accent—keeps
the silhouette representative without randomly deleting one visual region.

### Concrete render model

Upload once at trigger time:

```text
Per glyph, static:
  sourcePosition   float32x2
  destination      float32x2
  seed/phase       float32x2
  glyphAtlasIndex  uint16/uint32
  accentFlag       uint8/uint32

Per display frame, uniforms only:
  absoluteTime
  pointerPosition
  pointerStrength
  heroSize
```

One possible vertex-shader path is conceptually:

```text
release = eased clamp((time - delay(seed)) / duration(seed), 0, 1)
base = mix(sourcePosition, destination, release)
drift = seededSineAndArc(time, seed) * driftEnvelope(release)
pointerWarp = boundedField(base - pointerPosition, pointerStrength)
position = base + drift + pointerWarp
```

This is analytical animation. The pointer is a visual field, not a collision
object applying momentum. That distinction is desirable: it guarantees a
bounded response and eliminates the upward-impulse bugs that motivated the
fluid rewrite. Smooth only the two pointer coordinates on the CPU, then upload
them; never read GPU data back.

Use the existing glyph atlas and ink/accent colors. A static six-vertex quad
with one instance per glyph means one draw call. All positions remain in hero
coordinates and the existing overflow clip supplies the boundary. WebGL2
instanced drawing has been broadly available across current browsers since
2021 ([MDN compatibility summary](https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext/drawArraysInstanced)).

### Performance characteristics

- JavaScript per frame is constant-size: timestamp, smoothed pointer, uniforms,
  and one draw call.
- There is no physics step and no `bufferSubData()` position upload after
  initialization.
- GPU vertex work is independent per glyph and linear in the chosen glyph
  count.
- Raster cost is proportional to the small glyph quads, not to a complex
  full-screen fragment program.
- A lost frame does not trigger catch-up work.

The current renderer already proves the site can issue one instanced glyph
draw; this direction removes the expensive part that remains—the CPU solver and
dynamic position synchronization—rather than attempting to optimize it again.

### Limits and fallback

This is not persistent physics. If the mouse leaves a glyph, it returns
according to the current analytical field rather than carrying newly acquired
momentum. That is visually appropriate for wind, static electricity, or a lens,
but it should not be described as collision.

If WebGL initialization fails or the context is lost, switch to the paper-strip
shatter below. WebGL resources must be recreated after a restored context
because pre-loss textures and buffers are invalid
([MDN `webglcontextrestored`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/webglcontextrestored_event)).
There is no reason to fall back to thousands of Canvas `drawImage()` calls.

## 2. Compositor-only paper-strip or tile shatter

### Visual direction

Rasterize Puff once, crop it into 24–32 horizontal strips or irregular paper
tiles, and let those pieces peel, tumble, and scatter around the hero. Put the
pieces in three depth wrappers. The mouse updates one tilt/translation per
wrapper, creating cheap parallax without solving or updating each tile.

This fits the handmade site better than generic confetti: Puff looks drawn on a
sheet that has been torn into scraps. A few red-accent scraps remain distinctive
as they cross the black ones.

### Why it is cheap

Pre-crop each tile into its own bitmap/canvas once; do not animate `clip-path`,
filters, masks, layout dimensions, or background painting. Animate only
`transform` and `opacity` with CSS keyframes or `Element.animate()`. CSS
transforms are applied after sizing and positioning, so they do not alter the
surrounding layout ([CSS Transforms Level 1](https://www.w3.org/TR/css-transforms-1/#intro)).
Chrome's rendering guidance identifies compositor-only animation as the path
that avoids repeated style/layout/paint, while warning that non-composited
properties can look janky ([Chrome compositor animation guidance](https://developer.chrome.com/docs/lighthouse/performance/non-composited-animations)).
The Web Animations `Element.animate()` API is widely available and directly
creates and plays keyframe effects ([MDN `Element.animate`](https://developer.mozilla.org/en-US/docs/Web/API/Element/animate)).

Compositing is an optimization, not a promise. Confirm it in a browser trace.
Do not put `will-change` permanently on every tile: MDN warns that excessive
layer hints consume memory and can make rendering more complex
([MDN `will-change`](https://developer.mozilla.org/en-US/docs/Web/CSS/will-change)).
Enable it only shortly before the shatter and remove the tiles or hint when the
effect finishes.

### Interaction and limitation

The pointer should tilt three wrappers, not exert a separate force on 32 tiles.
This is `O(1)` author work per pointer frame and gives readable parallax. It is
less like playing with a field of glyphs, but it is the highest-confidence
choice if the requirement is “never make the hero feel slow again.”

The pieces can cover the whole hero during the burst but will not form a dense
persistent interactive world unless the design intentionally pins them around
the stage after the animation.

## 3. Strong low-cost alternative: static ASCII world with a pointer scanner

### Visual direction

Puff collapses into its red loop, which expands into a circular scanner. Behind
it is a pre-rendered, hero-wide ASCII scene: doodles, hidden HAM messages,
constellations, or tiny versions of the group's projects. The mouse moves a
soft circular reveal/glitch lens over that static scene. This is playful and
exploratory without moving thousands of independent things.

Render two static textures—the ordinary hero and the hidden ASCII world—on one
quad. The fragment shader selects/mixes them from pointer distance plus a small
scanline/noise term. JavaScript updates time and pointer only. An even cheaper
version uses a static DOM/canvas scene with a single moving overlay, but CSS
mask/clip compositing varies by engine and must be traced rather than assumed.

This option has the lowest conceptual risk after paper strips: its state is
just the pointer. It uses the full hero and is highly discoverable, but Puff's
individual characters do not remain independent objects.

## 4. Single-quad WebGL warp, ripple, dissolve, or glitch

### Visual direction

Capture Puff to a texture, then tear its rows sideways, quantize it into ASCII
blocks, dissolve it into scanlines, or create a cursor-driven lens. A
nearest-sampled block glitch preserves the terminal character feel better than
a smooth water ripple. The effect can stretch outward over the entire hero and
the pointer can control the distortion center and intensity.

### Cost and risk

It uses one draw call and constant-size JavaScript, but the fragment shader runs
over the canvas backing store. At 1,790×1,100 with DPR 2, a full-size backing
store contains about 7.9 million pixels before overdraw. Keep the shader simple,
avoid multi-pass blur, cap the effective DPR/back-buffer size, and upscale with
CSS. Mozilla's WebGL guidance explicitly recommends considering a smaller back
buffer and doing work in the vertex shader rather than the fragment shader when
possible ([MDN WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices#consider_rendering_to_a_smaller_back_buffer)).

This is likely fast on desktop hardware, but a single quad is not automatically
cheaper than 1,200 tiny glyph quads: it can shade substantially more pixels.
It also warps the rasterized glyph image rather than preserving glyph identity.

Choose this when the art direction is “Puff glitches out of reality,” not when
the desired delight is “play with Puff's characters.”

## 5. Independent ballistic glyph/dust particles without pair collisions

### Model

Use 800–1,200 representative glyphs, a glyph atlas, typed arrays, and no
particle-particle interaction. With no pointer momentum, ballistic motion is
analytical:

```text
x(t) = x0 + vx * t
y(t) = y0 + vy * t + 0.5 * gravity * t^2
```

Each glyph can receive a deterministic stagger, drag-looking easing, spin, and
fade. A cursor can apply a bounded instantaneous visual warp while retaining
the closed-form model. If cursor encounters permanently modify velocity, the
effect becomes a stateful `O(N)` particle animation: still much cheaper than
fluid, but it must update every glyph and handle elapsed-time gaps.

### Rendering choices

- WebGL instancing: one draw; upload positions only for the stateful variant.
- Canvas 2D: one atlas `drawImage()` per visible glyph. Broad fallback support,
  but main-thread draw work remains and should be capped near 800–1,000 glyphs.
- DOM elements: reject for this count; hundreds of independently updated text
  nodes/layers work against the objective.

The visual is a familiar burst/fall. It is easy to make smooth and easy to
bound, but it is less distinctive than the analytical wind and its pointer
interaction is either nonpersistent or reintroduces state.

## 6. Magnetic or target-seeking glyph cloud

### Visual direction

Puff explodes into 800–1,200 glyphs whose targets form a hero-wide word,
constellation, or silhouette. Each glyph follows an independent damped spring;
the cursor repels nearby glyphs and they return to their assigned targets.
This offers the richest ongoing play and the clearest “Puff became something
else” narrative.

### Model and cost

For each glyph:

```text
acceleration = spring * (target - position) - damping * velocity
acceleration += boundedPointerRepulsion(position, pointer)
velocity += acceleration * dt
position += velocity * dt
```

There are no pair interactions or spatial hash, so compute is strictly `O(N)`.
At 1,000 glyphs this should be dramatically cheaper than the fluid solver. It
still needs mutable position/velocity arrays, a clamped timestep, and either a
GPU position upload or a GPU-side state update. OffscreenCanvas could move such
work to a worker, and the API exists specifically to decouple canvas rendering
from the DOM/main thread ([MDN `OffscreenCanvas`](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas)),
but worker architecture is unnecessary complexity for only 1,000 independent
springs.

Choose this only if user testing says persistent push-and-return behavior is
worth a stateful loop. It is the best interactive option, not the best answer
to “stop doing simulation.”

## Recommended production design

### Primary path

Implement the analytical ASCII wind with these constraints:

1. Keep the existing ten-click trigger and desktop gating. `pointer: fine`
   explicitly detects an accurate primary pointing device such as a mouse and
   is broadly supported ([MDN `pointer` media feature](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/pointer)).
2. Preserve the final Puff frame as a temporary snapshot so transformation
   starts with the complete mascot.
3. Select 1,000–1,400 glyphs deterministically and stratified across source
   cells; always include red-accent glyphs.
4. Upload only static instance attributes. After trigger, never upload a
   position buffer.
5. Render one instanced draw. Limit effective canvas DPR to a measured cap,
   likely 1–1.5 for this full-hero decorative layer.
6. Smooth and clamp the pointer uniform. Let pointer distance produce a visual
   bend/vortex, not physical impulse or stored velocity.
7. Stop the rAF when the stage is offscreen. If the final field is stationary,
   draw once and sleep until the next pointer movement.
8. On WebGL creation failure or context loss, run the strip shatter; never
   activate a high-count Canvas particle fallback.

### Fallback path

Create 24–32 pre-cropped Puff strips, animate their transform/opacity once, and
let three parent wrappers tilt slightly toward the mouse. Remove the pieces or
freeze them after the reveal. This path needs no author simulation loop and is
available wherever CSS transforms and Web Animations run.

### Reduced motion

The current behavior of refusing the easter egg under reduced motion is valid.
If a transformed state is desired instead, use a short opacity dissolve to a
static ASCII constellation with no parallax, drift, zoom, or large-scale pan.
`prefers-reduced-motion` exists to detect a request to remove, reduce, or
replace nonessential motion and has broad browser support
([MDN `prefers-reduced-motion`](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion)).

## Rejected approaches

- **Another liquid, cloth, soft-body, or granular solver:** changes the
  physical model but not the maintenance/performance category the user wants
  to leave.
- **4,700 DOM glyph elements:** even if transforms can composite, creating
  thousands of elements/layers is the opposite of the small-layer strategy;
  browser guidance warns that excess compositing layers consume memory and can
  reduce performance ([MDN browser rendering guide](https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/How_browsers_work#compositing)).
- **A 4,700-glyph Canvas fallback:** removes density work but retains thousands
  of main-thread draw calls. The fallback should be qualitatively simpler.
- **Complex full-screen multi-pass blur/noise:** one quad with many texture
  samples can be slower than a sparse instanced glyph field; draw-call count is
  not the only cost.
- **Permanent `will-change` on every scrap:** layer hints are not free and are
  explicitly recommended only as a last resort.
- **WebGPU:** compute is unnecessary because the recommended path has nothing
  to compute recursively. WebGL2 already provides the required atlas,
  instancing, shaders, and broad reach.

## Validation gates

The replacement should be accepted by end-to-end presentation behavior, not by
solver timings or raw rAF counts:

1. Profile a production build at the same 1,790×1,100, DPR 2 desktop setup used
   for the fluid investigation, plus one integrated-GPU laptop.
2. Record the initial transformation and a ten-second full-depth pointer sweep.
3. Require one draw call, zero dynamic position uploads, and no fixed-step
   simulation callbacks on the analytical path.
4. Target JavaScript callback p95 below 2 ms and no presentation gaps above
   20 ms during the pointer sweep. Treat these as project gates, not platform
   guarantees.
5. Visually inspect slow motion: glyphs should advance continuously, pointer
   movement should be bounded, and a pointer jump must not launch the field.
6. Force WebGL context creation failure and context loss; verify the strip
   fallback starts without replaying the ten clicks or leaving Puff invisible.
7. Test `prefers-reduced-motion: reduce`, a coarse pointer, background-tab
   pause/resume, resizing, and the exact lower hero boundary above “Here’s what
   we’re working on.”

## Final recommendation

Prototype only two variants:

1. **Analytical ASCII wind** for the intended experience.
2. **Paper-strip shatter** for the guaranteed-cheap fallback and as a direct
   visual comparison.

Do not prototype another solver. If the analytical glyph version still feels
slow on the user's machine, choose the strip shatter rather than adding workers,
lower-level GPU compute, or another round of particle optimization. That is the
cleanest way to honor the new priority.
