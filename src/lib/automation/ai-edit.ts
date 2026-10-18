import type { PublicationStatus } from "../../content/types.ts";

/**
 * Who may do what to an article through the AI (MCP) editing tools.
 * Pure rules — the repository layer (repository.server.ts) loads the article,
 * its automation owner and the admin grant, then enforces these rules for
 * every AI read/edit/cover/delete. The MCP tool layer never decides alone.
 *
 * Rules:
 *  - Drafts/unpublished: the creating profile may edit; the master token
 *    (profile "default") may edit any draft; other profiles may edit only
 *    when the admin setting aiMayEditAllDrafts is on.
 *  - Published: locked for AI unless the admin turned on the per-article
 *    "Allow AI to edit this article" grant (articles.ai_edit_allowed).
 *    With a grant, AI may read/edit/cover but NEVER delete it and never
 *    change its status (the editing tools have no status field at all, and
 *    slug changes are refused on published articles to protect links).
 */
export type AiEditAction = "read" | "edit" | "cover" | "delete";
export type AiActor = { profileId: string; isMaster: boolean; editAllDrafts: boolean };
export type AiGuardResult = { viaGrant: boolean };

export const AI_LOCKED_PUBLISHED =
  "That article is published, and published articles are locked for AI editing. The owner can allow editing of this one article in the admin panel (article editor → “Allow AI to edit this article”).";

export function assertAiCanAccess(
  article: { status: PublicationStatus; slug: string; aiEditAllowed?: boolean },
  ownerProfileId: string | null,
  actor: AiActor,
  action: AiEditAction,
): AiGuardResult {
  if (article.status === "published") {
    if (!article.aiEditAllowed) throw new Error(AI_LOCKED_PUBLISHED);
    if (action === "delete") {
      throw new Error("That article is published. Even with an AI-edit grant, AI cannot delete a published article — the owner must do that in the admin panel.");
    }
    return { viaGrant: true };
  }
  // draft / unpublished
  if (actor.isMaster) return { viaGrant: false };
  if (ownerProfileId !== null && ownerProfileId === actor.profileId) return { viaGrant: false };
  if (actor.editAllDrafts) return { viaGrant: false };
  if (ownerProfileId !== null) {
    throw new Error(
      `That draft was created by a different automation profile (“${ownerProfileId}”). Your profile (“${actor.profileId}”) can only edit its own drafts unless the owner turns on “AI may edit drafts created by other automations” in the admin panel.`,
    );
  }
  throw new Error(
    "That draft was created by the owner (not by an automation profile), so only the master MCP token can edit it unless the owner turns on “AI may edit drafts created by other automations” in the admin panel.",
  );
}

/** Extra patch restrictions when editing through a published-article grant. */
export function assertAiPatchAllowed(
  article: { status: PublicationStatus; slug: string },
  patch: { slug?: string },
  viaGrant: boolean,
): void {
  if (viaGrant && patch.slug && patch.slug !== article.slug) {
    throw new Error("The slug of a published article cannot be changed by AI (it would break existing links). Ask the owner to rename it in the admin panel.");
  }
}
