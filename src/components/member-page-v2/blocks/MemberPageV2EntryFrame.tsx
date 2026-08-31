import type { MemberBlockRowRatio } from "@/lib/members/v2/document";

import { memberPageV2RowGridClass } from "../page-composition";

/**
 * The one grid frame for a two-block row.
 *
 * Public body and editor canvas render rows through this component, so the
 * three ratio templates and the below-`lg` single-column stacking live in a
 * single place. Each cell carries `min-w-0` so wide media and long prose
 * cannot force a column past the page. Once the cells become a horizontal
 * pair, they center against the row's taller block instead of both hanging
 * from the top edge.
 */
export function MemberPageV2EntryFrame({
  ratio,
  left,
  right,
}: {
  ratio: MemberBlockRowRatio;
  left: React.ReactNode;
  right: React.ReactNode;
}) {
  return (
    <div
      className={`${memberPageV2RowGridClass(ratio)} lg:items-center`}
      data-member-row-ratio={ratio}
    >
      <div className="min-w-0">{left}</div>
      <div className="min-w-0">{right}</div>
    </div>
  );
}
