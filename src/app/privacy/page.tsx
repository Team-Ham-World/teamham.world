import type { Metadata } from "next";
import Link from "next/link";

import {
  LegalDocument,
  type LegalSection,
} from "@/components/legal-document";

const LAST_UPDATED = "August 25, 2026";
const LAST_UPDATED_ISO = "2026-08-25";

export const metadata: Metadata = {
  title: "Privacy Policy — HAM",
  description:
    "How teamham.world collects, uses, shares, and protects information.",
  alternates: { canonical: "/privacy" },
};

const externalLinkClass =
  "font-bold text-interactive-blue underline decoration-2 underline-offset-4";

const sections: LegalSection[] = [
  {
    id: "scope",
    title: "Who this policy covers",
    content: (
      <>
        <p>
          This policy explains how HAM handles information on teamham.world,
          including its public pages, member sign-in, member pages, Puff game,
          and authorization service for HAM games. “HAM,” “we,” and “us” mean
          the group operating this site.
        </p>
        <p>
          Member-run subdomains and websites linked from this site are separate
          services. Their operators set their own privacy practices, even when
          an address ends in teamham.world.
        </p>
      </>
    ),
  },
  {
    id: "information",
    title: "Information we handle",
    content: (
      <>
        <p>The information involved depends on how you use the site:</p>
        <ul>
          <li>
            <strong>Ordinary visits.</strong> Our hosting provider processes
            standard request information such as IP address, browser and device
            details, requested URL, time, and diagnostic or security data. HAM
            does not add advertising pixels or third-party analytics trackers.
          </li>
          <li>
            <strong>Discord sign-in.</strong> We receive your Discord user ID,
            username, and the result of checking your membership and required
            role in the HAM Discord server. We store the ID, username,
            membership status and check time, account access status, and site
            role. We do not request or store your Discord email, avatar, or
            password.
          </li>
          <li>
            <strong>Sessions and authorization.</strong> We store hashed session
            and game authorization tokens, issue and expiry times, client and
            audience details, and a different pseudonymous subject ID for each
            connected HAM game. Raw tokens are shown only when issued and are
            not stored in the database.
          </li>
          <li>
            <strong>Member pages.</strong> We store the display name,
            introduction, website and social links, showcase details, artwork
            URL, and publishing status a member or administrator supplies.
          </li>
          <li>
            <strong>Puff leaderboard.</strong> If a signed-in member saves a
            score, we store the high score and achievement timestamps. The
            leaderboard displays the member’s Discord username, score, and
            rank.
          </li>
          <li>
            <strong>Requests to us.</strong> If you ask for help or make a data
            request, we handle the information you include in that conversation.
          </li>
        </ul>
        <p>
          Discord access tokens exist only briefly in server memory while we
          verify a sign-in. We do not store Discord access or refresh tokens in
          our database.
        </p>
      </>
    ),
  },
  {
    id: "use",
    title: "Why we use it",
    content: (
      <>
        <p>We use information to:</p>
        <ul>
          <li>verify HAM membership and operate secure member sessions;</li>
          <li>provide, publish, and administer member pages;</li>
          <li>run the Puff leaderboard and authorize supported HAM games;</li>
          <li>prevent abuse, investigate failures, and protect the service;</li>
          <li>respond to requests and enforce our Terms of Service; and</li>
          <li>meet legal obligations when they apply.</li>
        </ul>
        <p>
          Where applicable law requires a legal basis, these purposes rely on
          providing the service you request, HAM’s legitimate interests in
          operating a safe private community service, consent where requested,
          and compliance with law. We do not sell personal information or use it
          for targeted advertising.
        </p>
      </>
    ),
  },
  {
    id: "public",
    title: "What becomes public",
    content: (
      <>
        <p>
          Published member-page content is visible to anyone. This can include a
          display name, introduction, website, social profiles, showcase text,
          project links, and artwork. Search engines, archives, and other people
          may copy public information beyond HAM’s control.
        </p>
        <p>
          Puff leaderboard entries publicly show a Discord username, high
          score, and rank. We do not publicly show Discord user IDs, account IDs,
          access roles, membership-check details, or session data.
        </p>
      </>
    ),
  },
  {
    id: "cookies",
    title: "Cookies and local storage",
    content: (
      <>
        <p>
          The site uses only essential, first-party cookies for sign-in and game
          authorization. They are marked Secure, HttpOnly, and SameSite=Lax, so
          client-side scripts cannot read them and browsers limit when they are
          sent.
        </p>
        <ul>
          <li>
            The member session cookie lasts no more than 24 hours in the browser.
          </li>
          <li>
            OAuth state and pending game-authorization cookies last no more than
            10 minutes and are normally cleared when the flow finishes.
          </li>
        </ul>
        <p>
          We do not use advertising cookies. Blocking essential cookies will
          prevent sign-in and connected-game authorization from working.
        </p>
      </>
    ),
  },
  {
    id: "sharing",
    title: "Providers and third parties",
    content: (
      <>
        <p>We use a small set of providers to operate the site:</p>
        <ul>
          <li>
            <a
              href="https://discord.com/privacy"
              rel="noopener noreferrer"
              className={externalLinkClass}
            >
              Discord
            </a>{" "}
            provides identity and guild-role verification.
          </li>
          <li>
            <a
              href="https://vercel.com/legal/privacy-notice"
              rel="noopener noreferrer"
              className={externalLinkClass}
            >
              Vercel
            </a>{" "}
            hosts and delivers the application and may process network and
            operational logs.
          </li>
          <li>
            <a
              href="https://neon.com/privacy-policy"
              rel="noopener noreferrer"
              className={externalLinkClass}
            >
              Neon
            </a>{" "}
            hosts the application database.
          </li>
        </ul>
        <p>
          A connected HAM game receives a game-specific pseudonymous subject ID
          and authorization status, not your Discord ID or username. We may also
          disclose information when required by law or reasonably necessary to
          protect people, HAM, or the service.
        </p>
        <p>
          Member pages can contain third-party links and remotely hosted
          artwork. When you follow a link, that site receives your visit. When
          remote artwork loads, its host receives ordinary image-request data;
          the site suppresses the referring page. If a member saves a project
          URL without artwork, HAM may make a server-side request to that URL to
          find its Open Graph image.
        </p>
      </>
    ),
  },
  {
    id: "retention",
    title: "How long we keep it",
    content: (
      <>
        <p>
          A browser session expires within 24 hours. Signing in again replaces
          the stored session, and logging out or confirmed loss of membership
          removes the active session. Game authorization codes expire within 60
          seconds and game access tokens within 24 hours; expired hashed records
          can remain until they are replaced or removed, but cannot be used.
          Per-game pseudonymous subject IDs persist so a returning member keeps
          the same game identity.
        </p>
        <p>
          Account records, member content, and scores do not currently have a
          fixed automatic deletion date. We keep them while needed to operate
          HAM’s services, preserve account and game continuity, resolve safety
          issues, or meet legal obligations. Provider logs and backups follow
          provider retention schedules, and deletion from backups may lag behind
          deletion from the live service.
        </p>
      </>
    ),
  },
  {
    id: "choices",
    title: "Your choices and requests",
    content: (
      <>
        <p>
          Members can edit the content they maintain and can log out to end an
          active browser session. Ask a HAM administrator to unpublish a page or
          remove leaderboard content that you cannot remove yourself.
        </p>
        <p>
          You may ask to access, correct, export, or delete information HAM holds
          about you. Some requests may require verification, and we may retain
          limited information where law, security, or another person’s rights
          require it. For Discord’s own records, use Discord’s privacy controls
          or contact Discord directly.
        </p>
      </>
    ),
  },
  {
    id: "security-children",
    title: "Security and younger users",
    content: (
      <>
        <p>
          We use HTTPS, restricted database permissions, hashed tokens, short
          authorization lifetimes, and access checks designed to protect stored
          information. No service can promise perfect security, so please tell
          us promptly if you find a problem.
        </p>
        <p>
          The service is not directed to children under 13. Member sign-in is
          only for people permitted to use Discord under Discord’s rules. If you
          believe we hold information from a child who should not use the
          service, contact us so we can investigate and remove it where required.
        </p>
      </>
    ),
  },
  {
    id: "changes-contact",
    title: "Changes and contact",
    content: (
      <>
        <p>
          We may update this policy as the site changes. The date at the top
          identifies the current version. If a change materially affects member
          information, we will provide a more prominent notice when reasonably
          practical or legally required.
        </p>
        <p>
          For privacy questions or requests, contact CyR1en (@cyr1en on Discord)
          or contact Team HAM through the private Discord server. Please do not
          send passwords, session tokens, or other secrets.
        </p>
        <p>
          The rules for using the site are in our{" "}
          <Link href="/terms">Terms of Service</Link>.
        </p>
      </>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalDocument
      documentCode="HAM / PRIVACY"
      eyebrow="Your data, plainly"
      title="Privacy Policy"
      summary="We collect the minimum needed to run member access, public profiles, and HAM games—and we explain the edges here."
      lastUpdated={LAST_UPDATED}
      lastUpdatedIso={LAST_UPDATED_ISO}
      sections={sections}
    />
  );
}
