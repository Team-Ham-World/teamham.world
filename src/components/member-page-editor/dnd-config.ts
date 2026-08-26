/** Stable, explicit IDs shared without importing dnd-kit into the editor shell. */
export const MEMBER_PAGE_DND_CONTEXT_ID = "member-page-block-sorter";

export function memberPageDndContextId(slug: string): string {
  return `${MEMBER_PAGE_DND_CONTEXT_ID}-${slug}`;
}
