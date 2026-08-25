import type { Metadata } from "next";
import Link from "next/link";

import {
  LegalDocument,
  type LegalSection,
} from "@/components/legal-document";

const LAST_UPDATED = "August 25, 2026";
const LAST_UPDATED_ISO = "2026-08-25";

export const metadata: Metadata = {
  title: "Terms of Service — HAM",
  description: "The rules for using teamham.world and HAM member services.",
  alternates: { canonical: "/terms" },
};

const externalLinkClass =
  "font-bold text-interactive-blue underline decoration-2 underline-offset-4";

const sections: LegalSection[] = [
  {
    id: "agreement",
    title: "About these terms",
    content: (
      <>
        <p>
          These Terms of Service govern your use of teamham.world, including its
          public pages, member features, Puff game, and authorization service for
          HAM games. “HAM,” “we,” and “us” mean the group operating this site.
        </p>
        <p>
          By using the service, you agree to these terms. If you do not agree,
          do not use member, game, or interactive features. Public pages remain
          available to read without an account.
        </p>
      </>
    ),
  },
  {
    id: "service",
    title: "What HAM provides",
    content: (
      <>
        <p>
          HAM is a private group of friends who make things. The site provides a
          public project shelf and member directory, private member access,
          member-managed profile pages, small community games, and sign-in for
          supported HAM games.
        </p>
        <p>
          The website is not a public membership application, marketplace, or
          paid service. Joining HAM happens privately outside this website, and
          nothing on the site is an offer to sell a product or membership.
        </p>
      </>
    ),
  },
  {
    id: "eligibility",
    title: "Eligibility and accounts",
    content: (
      <>
        <p>
          Public pages can be viewed by anyone. Member features are limited to
          people who are permitted to use Discord, belong to the configured HAM
          Discord server, and hold the required member role. Access is verified
          through Discord each time a fresh session is issued.
        </p>
        <p>
          You are responsible for your Discord account and for activity under
          your HAM session. Do not share session or game tokens. Tell a HAM
          administrator promptly if you believe your account or session has been
          compromised. Signing in on another browser can replace your current
          session.
        </p>
      </>
    ),
  },
  {
    id: "conduct",
    title: "Use it like a good neighbor",
    content: (
      <>
        <p>You may not use the service to:</p>
        <ul>
          <li>break the law or violate another person’s rights or privacy;</li>
          <li>
            harass, threaten, impersonate, deceive, or publish hateful or abusive
            material;
          </li>
          <li>
            upload, link to, or distribute malware, destructive code, or content
            designed to compromise another system;
          </li>
          <li>
            probe, bypass, or interfere with authentication, authorization, rate
            limits, or other security controls;
          </li>
          <li>
            disrupt the service or send automated traffic that creates an
            unreasonable burden; or
          </li>
          <li>
            misrepresent a project, its makers, your affiliation, or your right
            to publish content.
          </li>
        </ul>
        <p>
          Responsible security research performed in good faith should minimize
          access to other people’s data and be reported privately before public
          disclosure.
        </p>
      </>
    ),
  },
  {
    id: "member-content",
    title: "Member content",
    content: (
      <>
        <p>
          You keep ownership of content you submit. You give HAM a worldwide,
          non-exclusive, royalty-free license to host, store, reproduce, format,
          and display that content only as needed to operate, secure, and promote
          the HAM service. This license ends when the content is removed, except
          for reasonable technical backups and copies already made by others.
        </p>
        <p>
          Only submit content you have the right to use. For website, social,
          source, project, and artwork URLs, you confirm that the link and its
          display do not infringe another person’s rights or mislead visitors.
          Public member content may be indexed, archived, or copied by third
          parties beyond HAM’s control.
        </p>
        <p>
          HAM administrators may edit publishing status, reject, unpublish, or
          remove content that violates these terms, creates risk, is no longer
          accurate, or does not fit the purpose of the site.
        </p>
      </>
    ),
  },
  {
    id: "games",
    title: "Games and scores",
    content: (
      <>
        <p>
          HAM games may use this site to verify an active member and receive a
          game-specific pseudonymous identifier. A game receives only the
          authorization information described in the{" "}
          <Link href="/privacy">Privacy Policy</Link>; it does not receive your
          Discord ID or HAM browser session token from the authorization service.
        </p>
        <p>
          Scores must result from ordinary use of the game. Do not forge,
          automate, replay, or manipulate score submissions. HAM may correct or
          remove scores that are invalid, abusive, or technically impossible.
        </p>
      </>
    ),
  },
  {
    id: "third-parties",
    title: "Third-party services and links",
    content: (
      <>
        <p>
          Discord provides member authentication, and the site relies on hosting
          and database providers. Their services are governed by their own terms
          and policies. You can review Discord’s{" "}
          <a
            href="https://discord.com/terms"
            rel="noopener noreferrer"
            className={externalLinkClass}
          >
            Terms of Service
          </a>{" "}
          and{" "}
          <a
            href="https://discord.com/privacy"
            rel="noopener noreferrer"
            className={externalLinkClass}
          >
            Privacy Policy
          </a>
          .
        </p>
        <p>
          Member pages and project cards can link to websites, social networks,
          repositories, and remotely hosted images HAM does not control. A link
          is not an endorsement or warranty. Use third-party services at your own
          discretion and review their terms before sharing information with them.
        </p>
      </>
    ),
  },
  {
    id: "ownership",
    title: "HAM materials",
    content: (
      <>
        <p>
          The HAM name, wordmark, original site design, copy, graphics, and
          software remain the property of HAM or their respective contributors,
          except where a separate license or attribution says otherwise. Brand
          names and logos belonging to Discord, social platforms, members, and
          projects remain the property of their respective owners.
        </p>
        <p>
          These terms do not grant permission to imply HAM endorsement, copy a
          member’s work, or use someone else’s name or likeness beyond what the
          law independently permits.
        </p>
      </>
    ),
  },
  {
    id: "availability",
    title: "Changes and availability",
    content: (
      <>
        <p>
          HAM may add, change, suspend, or discontinue features at any time. We
          do not promise that the service will always be available, error-free,
          secure, or compatible with every browser, game, or third-party service.
          Project status and member content can change without notice.
        </p>
        <p>
          We may update these terms. The date at the top identifies the current
          version. Continued use after an update takes effect means you accept
          the revised terms; when a material change affects members, we will
          provide a more prominent notice when reasonably practical.
        </p>
      </>
    ),
  },
  {
    id: "suspension",
    title: "Suspension and removal",
    content: (
      <>
        <p>
          Member access can end when Discord eligibility changes, an account is
          suspended, a session expires, or a member leaves HAM. HAM may also
          suspend access, revoke game authorization, unpublish content, or remove
          scores when reasonably necessary to enforce these terms, protect the
          service, or respond to legal or safety concerns.
        </p>
        <p>
          Provisions that logically need to survive—such as ownership,
          disclaimers, limits of liability, and responsibility for earlier
          conduct—continue after access ends.
        </p>
      </>
    ),
  },
  {
    id: "disclaimer",
    title: "Disclaimers and responsibility",
    content: (
      <>
        <p>
          To the extent permitted by law, the service is provided “as is” and
          “as available,” without express or implied warranties. HAM and its
          contributors are not responsible for third-party services, member-run
          sites, linked content, loss of data, or indirect, incidental, special,
          consequential, or punitive damages arising from use of the service.
        </p>
        <p>
          Nothing in these terms excludes a right, warranty, or liability that
          applicable law does not allow us to exclude. You are responsible for
          maintaining your own copies of content you care about.
        </p>
      </>
    ),
  },
  {
    id: "contact",
    title: "Questions",
    content: (
      <>
        <p>
          For questions about these terms, contact CyR1en (@cyr1en on Discord)
          or contact Team HAM through the private Discord server. For information
          requests and privacy choices, read the{" "}
          <Link href="/privacy">Privacy Policy</Link>.
        </p>
      </>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalDocument
      documentCode="HAM / TERMS"
      eyebrow="The house rules"
      title="Terms of Service"
      summary="Make things, respect people, and do not make the small amount of infrastructure we have regret meeting you."
      lastUpdated={LAST_UPDATED}
      lastUpdatedIso={LAST_UPDATED_ISO}
      sections={sections}
    />
  );
}
