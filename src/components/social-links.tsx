import {
  getSocialPlatform,
  SOCIAL_PLATFORMS,
  type MemberSocialLinks,
  type SocialPlatform,
} from "@/lib/members/socials";

export function SocialIcon({
  platform,
  className = "size-5",
}: {
  platform: SocialPlatform;
  className?: string;
}) {
  const definition = getSocialPlatform(platform);
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
    >
      <path d={definition.iconPath} />
    </svg>
  );
}

export function MemberSocialLinks({
  displayName,
  links,
}: {
  displayName: string;
  links: MemberSocialLinks;
}) {
  const activeLinks = SOCIAL_PLATFORMS.flatMap((platform) => {
    const href = links[platform.id];
    return href ? [{ ...platform, href }] : [];
  });
  if (activeLinks.length === 0) return null;

  return (
    <nav aria-label={`${displayName}'s social links`}>
      <ul className="flex flex-wrap gap-3">
        {activeLinks.map((platform, index) => (
          <li key={platform.id}>
            <a
              href={platform.href}
              rel="noopener noreferrer"
              aria-label={`Visit ${displayName} on ${platform.label}`}
              title={platform.label}
              className={`inline-flex size-11 items-center justify-center border-2 border-ink bg-surface text-ink shadow-[3px_3px_0_0_var(--color-ink)] transition-[transform,background-color,color,box-shadow] hover:-translate-y-0.5 hover:rotate-0 hover:bg-interactive-blue hover:text-paper active:translate-x-0.5 active:translate-y-0.5 active:shadow-none ${index % 2 === 0 ? "-rotate-2" : "rotate-1"}`}
            >
              <SocialIcon platform={platform.id} />
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
