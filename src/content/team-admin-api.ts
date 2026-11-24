import { createServerFn } from "@tanstack/react-start";
import { teamSettingsSchema, type TeamSettings } from "@/lib/team";

async function guard() {
  const { requireAdmin } = await import("@/lib/auth/admin.server");
  return requireAdmin();
}

async function writeGuard() {
  const { requireWriter } = await import("@/lib/auth/admin.server");
  return requireWriter();
}

export const adminTeam = createServerFn({ method: "GET" }).handler(async () => {
  await guard();
  const { readTeamSettings } = await import("./team.server");
  return readTeamSettings();
});

export const adminSaveTeam = createServerFn({ method: "POST" })
  .validator((data: TeamSettings) => teamSettingsSchema.parse(data))
  .handler(async ({ data }) => {
    await writeGuard();
    const { saveTeamSettings } = await import("./team.server");
    return saveTeamSettings(data);
  });
