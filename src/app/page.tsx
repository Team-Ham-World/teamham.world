import { PuffScene } from "@/components/puff-scene";
import { ProjectShelf } from "@/components/project-shelf";

/*
 * Single-page hub. Simple, one-use static sections stay inline here rather than
 * being fragmented into components that would each have exactly one caller —
 * the hero's only extracted part is the mascot, which has to be a client island
 * because it animates.
 */
export default function Home() {
  return (
    <>
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 pb-16 sm:px-8">
        {/*
         * The hero is exactly one viewport tall, less the header above it, so
         * the mascot is the whole of the first impression and the shelf begins
         * on the first scroll.
         */}
        <section className="flex min-h-[calc(100svh-var(--nav-height))] flex-col pb-6">
          <div className="flex flex-1 flex-col gap-6 pt-8 lg:grid lg:grid-cols-[1fr_1.1fr] lg:items-center lg:gap-10 lg:pt-0">
            <div className="max-w-2xl">
              {/* Torn-tag eyebrow. Both halves are facts stated further down the
                  page: a private group, whose shelf is the public part. */}
              <p className="inline-flex -rotate-1 items-center border-2 border-ink bg-surface px-3 py-1 text-[0.7rem] font-bold tracking-[0.18em] text-ink uppercase shadow-[3px_3px_0_0_var(--color-ink)] sm:text-xs">
                Private group &#183; public shelf
              </p>

              <h1 className="font-display mt-7 text-4xl leading-[1.15] sm:text-5xl lg:text-[3.4rem]">
                HAM is a group of friends who make things on the internet.
              </h1>
            </div>

            {/*
             * `min-h-0` is load-bearing on the phone layout: a flex item's
             * default minimum is its content, and without this the stage
             * refuses to shrink and pushes the scroll cue off the viewport the
             * hero is supposed to fit inside.
             */}
            <div className="flex min-h-0 flex-1 flex-col justify-center lg:h-[70svh] lg:flex-none">
              <PuffScene className="min-h-0 w-full flex-1 lg:h-full" />
            </div>
          </div>

          <p className="mt-4 flex shrink-0 items-baseline gap-3 text-sm font-bold tracking-[0.16em] text-muted uppercase">
            {/*
             * Baseline alignment keeps the cue on the first line when the label
             * wraps; the 1px lift optically centers the arrow against the
             * all-caps label, since the glyph carries ink below the baseline and
             * the capitals do not. Offset via `top` because the nudge animation
             * owns `transform`.
             */}
            <span
              aria-hidden="true"
              className="animate-nudge relative -top-px inline-block text-base"
            >
              &#8595;
            </span>
            Here&#8217;s what we&#8217;re working on.
          </p>
        </section>

        <section
          id="things"
          aria-labelledby="things-heading"
          className="mt-16 sm:mt-24"
        >
          <h2
            id="things-heading"
            className="font-display relative inline-block text-3xl sm:text-4xl"
          >
            Things
            {/* Hand-drawn underline — decorative accent, carries no meaning. */}
            <svg
              aria-hidden="true"
              viewBox="0 0 120 8"
              preserveAspectRatio="none"
              className="absolute -bottom-2 left-0 h-2 w-full text-decorative-red"
            >
              <path
                d="M2 5 C 26 1, 42 8, 64 4 S 100 2, 118 6"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          </h2>

          <div className="mt-12">
            <ProjectShelf />
          </div>
        </section>

        <section
          id="whats-this"
          aria-labelledby="whats-this-heading"
          className="mt-20 max-w-2xl sm:mt-28"
        >
          <h2
            id="whats-this-heading"
            className="font-display text-3xl sm:text-4xl"
          >
            What&#8217;s this?
          </h2>
          <p className="mt-6 text-lg leading-relaxed text-muted">
            HAM is a private group of friends. We hang out in our own Discord
            and build things when someone has an idea and other people show up.
            There&#8217;s nothing to join and nothing to buy&#8212;this page is
            just our shelf, made public so the things have a home.
          </p>
        </section>
      </main>

      <footer className="mx-auto w-full max-w-5xl px-5 pb-12 sm:px-8">
        <div className="border-t-2 border-ink pt-6 text-sm tracking-wide text-muted">
          teamham.world &#183; made by HAM
        </div>
      </footer>
    </>
  );
}
