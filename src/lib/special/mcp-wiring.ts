/**
 * t173: how special articles plug into the existing MCP tool list (pure, testable).
 * Normal behaviour is untouched: a submit without article_type (or 'regular')
 * runs the original tool exactly; with special mode off the advertised
 * tools/list is identical to before.
 */
import type { ToolDefinition, ToolResult } from "../mcp/protocol.ts";
import { ASSIGNED_NORMAL_MESSAGE, ASSIGNED_SPECIAL_MESSAGE, type ProfileAssignment } from "./settings.ts";

export const SPECIAL_OFF_MESSAGE = "Special articles are not enabled for this automation profile. The owner turns them on in Automation → Special (and chooses the eligible categories).";

export type SpecialHandlers = {
  /** Extra JSON-schema properties advertised on submit_article_draft while special mode is on. */
  submitProperties: Record<string, unknown>;
  submit: (args: unknown) => Promise<ToolResult>;
  update: (args: unknown) => Promise<ToolResult>;
  isSpecial: (articleId: string) => Promise<boolean>;
  view: (articleId: string) => Promise<Record<string, unknown> | null>;
  brief: () => Promise<unknown>;
  research: () => ToolDefinition[];
};

function argsOf(args: unknown): Record<string, unknown> {
  return args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
}

function withProps(schema: Record<string, unknown>, props: Record<string, unknown>): Record<string, unknown> {
  const base = schema as { properties?: Record<string, unknown> };
  return { ...schema, properties: { ...(base.properties ?? {}), ...props } };
}

/**
 * `on` = special mode is enabled for the calling profile.
 * `assignment` (t178) = whether the calling profile is assigned to Normal or Special.
 * Profiles are exclusive: a Special profile cannot create or change normal articles,
 * a Normal profile cannot write specials. Normal (the default) keeps the legacy behaviour.
 */
export function applySpecialTools(tools: ToolDefinition[], on: boolean, h: SpecialHandlers, assignment: ProfileAssignment = "normal"): ToolDefinition[] {
  const specialOnly = assignment === "special";
  const out = tools.map((tool): ToolDefinition => {
    const original = tool.run;
    if (tool.name === "submit_article_draft") {
      return {
        ...tool,
        inputSchema: on ? withProps(tool.inputSchema, h.submitProperties) : tool.inputSchema,
        run: async (args: unknown): Promise<ToolResult> => {
          const a = argsOf(args);
          if (a.article_type !== undefined && a.article_type !== "regular" && a.article_type !== "special") return { ok: false, error: "article_type must be 'regular' or 'special'." };
          const wantsSpecial = a.article_type === "special";
          if (!wantsSpecial && specialOnly) return { ok: false, error: ASSIGNED_SPECIAL_MESSAGE };
          if (!("article_type" in a) || a.article_type === undefined) return original(args);
          if (a.article_type === "regular") {
            const { article_type: _drop, ...rest } = a;
            return original(rest);
          }
          if (!specialOnly) return { ok: false, error: ASSIGNED_NORMAL_MESSAGE };
          if (!on) return { ok: false, error: SPECIAL_OFF_MESSAGE };
          return h.submit(args);
        },
      };
    }
    if (tool.name === "get_article") {
      return {
        ...tool,
        run: async (args: unknown) => {
          const res = await original(args);
          if (!res.ok) return res;
          const id = argsOf(args).article_id;
          const extra = typeof id === "string" ? await h.view(id).catch(() => null) : null;
          return extra ? { ok: true, data: { ...(res.data as Record<string, unknown>), ...extra } } : res;
        },
      };
    }
    if (tool.name === "update_article_draft") {
      return {
        ...tool,
        run: async (args: unknown) => {
          const id = argsOf(args).article_id;
          if (typeof id === "string" && (await h.isSpecial(id).catch(() => false))) return h.update(args);
          if (specialOnly) return { ok: false, error: ASSIGNED_SPECIAL_MESSAGE };
          return original(args);
        },
      };
    }
    if (tool.name === "publish_article_if_allowed" && specialOnly) {
      return {
        ...tool,
        run: async (args: unknown) => {
          const id = argsOf(args).article_id;
          if (typeof id === "string" && !(await h.isSpecial(id).catch(() => false))) return { ok: false, error: ASSIGNED_SPECIAL_MESSAGE };
          return original(args);
        },
      };
    }
    if (tool.name === "get_blog_settings" && on) {
      return {
        ...tool,
        run: async (args: unknown) => {
          const res = await original(args);
          if (!res.ok) return res;
          return { ok: true, data: { ...(res.data as Record<string, unknown>), special: await h.brief() } };
        },
      };
    }
    return tool;
  });
  return on ? [...out, ...h.research()] : out;
}
