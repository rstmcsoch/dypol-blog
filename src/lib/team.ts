import { z } from "zod";

export const teamMemberSchema = z.object({
  id: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(120),
  role: z.string().trim().min(1).max(120),
  bio: z.string().trim().max(240).optional(),
  visible: z.boolean().optional(),
});

export const teamGroupSchema = z.object({
  id: z.string().trim().min(1).max(80),
  kicker: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(200),
  note: z.string().trim().max(300),
  visible: z.boolean().optional(),
  members: z.array(teamMemberSchema).max(60),
});

export const teamSettingsSchema = z.object({
  kicker: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(200),
  lede: z.string().trim().min(1).max(500),
  groups: z.array(teamGroupSchema).max(20),
});

export type TeamMember = z.infer<typeof teamMemberSchema>;
export type TeamGroup = z.infer<typeof teamGroupSchema>;
export type TeamSettings = z.infer<typeof teamSettingsSchema>;

export const DEFAULT_TEAM_SETTINGS: TeamSettings = {
  kicker: "DYPOL Blog / Editorial",
  title: "The people behind the story.",
  lede: "DYPOL Blog is made by editors and writers who care about clarity, accuracy and the craft of a good tech story. Meet the newsroom behind every headline.",
  groups: [
    {
      id: "leadership",
      kicker: "Editorial leadership",
      title: "The desk that sets the line",
      note: "Direction, standards and final editorial judgment.",
      members: [
        { id: "tm-rowan-grant", name: "Rowan Grant", role: "Editor-in-Chief" },
        { id: "tm-henrik-lindqvist", name: "Henrik Lindqvist", role: "Managing Editor" },
        { id: "tm-saanvi-joshi", name: "Saanvi Joshi", role: "Deputy Editor" },
        { id: "tm-mira-solberg", name: "Mira Solberg", role: "Senior Editor" },
      ],
    },
    {
      id: "copy",
      kicker: "Copy desk",
      title: "Clarity, before anything goes live",
      note: "Line edits, accuracy checks and the final polish.",
      members: [{ id: "tm-aisha-rahman", name: "Aisha Rahman", role: "Copy Editor" }],
    },
    {
      id: "senior-staff",
      kicker: "Senior staff writers",
      title: "Experienced voices on the beat",
      note: "Deep reporting across the stories that matter.",
      members: [
        { id: "tm-lucas-bennett", name: "Lucas Bennett", role: "Senior Staff Writer" },
        { id: "tm-akira-fujita", name: "Akira Fujita", role: "Senior Staff Writer" },
        { id: "tm-sophie-williams", name: "Sophie Williams", role: "Senior Staff Writer" },
      ],
    },
    {
      id: "staff",
      kicker: "Staff writers",
      title: "The reporting engine",
      note: "Daily coverage, research and sharp explainers.",
      members: [
        { id: "tm-advait-sharma", name: "Advait Sharma", role: "Staff Writer" },
        { id: "tm-samir-nasser", name: "Samir Nasser", role: "Staff Writer" },
        { id: "tm-yasmin-nasser", name: "Yasmin Nasser", role: "Staff Writer" },
        { id: "tm-ishikawa-yusei", name: "Ishikawa Yusei", role: "Staff Writer" },
        { id: "tm-elena-vance", name: "Elena Vance", role: "Staff Writer" },
        { id: "tm-arjun-mehta", name: "Arjun Mehta", role: "Staff Writer" },
        { id: "tm-freya-dalton", name: "Freya Dalton", role: "Staff Writer" },
        { id: "tm-shanaya-negi", name: "Shanaya Negi", role: "Staff Writer" },
        { id: "tm-paisley-warren", name: "Paisley Warren", role: "Staff Writer" },
        { id: "tm-carson-walker", name: "Carson Walker", role: "Staff Writer" },
      ],
    },
  ],
};

export function normalizeTeamSettings(input: unknown): TeamSettings {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const merged = {
    ...DEFAULT_TEAM_SETTINGS,
    ...raw,
    groups: Array.isArray(raw.groups) ? raw.groups : DEFAULT_TEAM_SETTINGS.groups,
  };
  const parsed = teamSettingsSchema.safeParse(merged);
  if (parsed.success) return parsed.data;
  const out: TeamSettings = { ...DEFAULT_TEAM_SETTINGS };
  const top = teamSettingsSchema.shape;
  for (const key of ["kicker", "title", "lede"] as const) {
    const v = raw[key];
    if (top[key].safeParse(v).success) out[key] = v as never;
  }
  if (Array.isArray(raw.groups)) {
    const groups: TeamGroup[] = [];
    for (const g of raw.groups) {
      const gr = g && typeof g === "object" ? (g as Record<string, unknown>) : {};
      const group: TeamGroup = {
        id: typeof gr.id === "string" && gr.id.trim() ? gr.id.trim().slice(0, 80) : `g-${groups.length + 1}`,
        kicker: typeof gr.kicker === "string" && gr.kicker.trim() ? gr.kicker.trim().slice(0, 120) : "Group",
        title: typeof gr.title === "string" && gr.title.trim() ? gr.title.trim().slice(0, 200) : "Team group",
        note: typeof gr.note === "string" ? gr.note.trim().slice(0, 300) : "",
        ...(gr.visible === false ? { visible: false } : {}),
        members: Array.isArray(gr.members)
          ? gr.members
              .flatMap((m, i) => {
                const mr = m && typeof m === "object" ? (m as Record<string, unknown>) : {};
                const name = typeof mr.name === "string" ? mr.name.trim().slice(0, 120) : "";
                const role = typeof mr.role === "string" ? mr.role.trim().slice(0, 120) : "";
                if (!name || !role) return [];
                const id = typeof mr.id === "string" && mr.id.trim() ? mr.id.trim().slice(0, 80) : `m-${groups.length + 1}-${i + 1}`;
                const bio = typeof mr.bio === "string" && mr.bio.trim() ? mr.bio.trim().slice(0, 240) : undefined;
                return [{ id, name, role, ...(bio ? { bio } : {}), ...(mr.visible === false ? { visible: false } : {}) }];
              })
              .slice(0, 60)
          : [],
      };
      groups.push(group);
    }
    out.groups = groups.slice(0, 20);
  }
  return teamSettingsSchema.parse(out);
}

export function teamMemberCount(settings: TeamSettings, visibleOnly = false): number {
  return settings.groups.reduce((n, g) => {
    if (visibleOnly && g.visible === false) return n;
    const count = visibleOnly ? g.members.filter((m) => m.visible !== false).length : g.members.length;
    return n + count;
  }, 0);
}

export function createTeamId(prefix: "g" | "m"): string {
  const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return `${prefix}-${rand}`;
}
