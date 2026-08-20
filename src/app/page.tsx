import { HamWordmark } from "@/components/ham-wordmark";
import { ProjectShelf } from "@/components/project-shelf";

/*
 * Single-page hub. Simple, one-use static sections stay inline here rather than
 * being fragmented into components that would each have exactly one caller.
 */
export default function Home() {
  return (
    <>
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 pt-20 pb-16 sm:px-8 sm:pt-28">
        <section className="max-w-3xl">
          {/* The wordmark is the group's own hand-drawn mark, traced to vector. */}
          <h1>
            <HamWordmark className="h-auto w-52 text-ink sm:w-64" />
          </h1>

          <p className="font-display mt-12 text-3xl leading-[1.25] sm:text-4xl md:text-5xl">
            HAM is a group of friends who make things on the internet.
          </p>

          <p className="mt-10 flex items-start gap-3 text-sm font-bold tracking-[0.16em] text-muted uppercase">
            <span
              aria-hidden="true"
              className="animate-nudge inline-block text-base"
            >
              &#8595;
            </span>
            Here&#8217;s what we&#8217;re working on.
          </p>
        </section>

        <section
          id="things"
          aria-labelledby="things-heading"
          className="mt-20 sm:mt-28"
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
