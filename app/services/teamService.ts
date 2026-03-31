import { eq, and } from "drizzle-orm";
import { db } from "~/db";
import { teams, teamMembers, TeamMemberRole } from "~/db/schema";

// ─── Team Service ───
// Handles team creation, admin assignment, and team lookup by user.
// One team per user (auto-created on first team purchase).

export async function createTeam() {
  const [row] = await db.insert(teams).values({}).returning();
  return row;
}

export async function addTeamMember(
  teamId: number,
  userId: number,
  role: TeamMemberRole
) {
  const [row] = await db
    .insert(teamMembers)
    .values({ teamId, userId, role })
    .returning();
  return row;
}

export async function getTeamForAdmin(userId: number) {
  const [membership] = await db
    .select()
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.userId, userId),
        eq(teamMembers.role, TeamMemberRole.Admin)
      )
    );

  if (!membership) return undefined;

  const [team] = await db.select().from(teams).where(eq(teams.id, membership.teamId));
  return team;
}

export async function getOrCreateTeamForUser(userId: number) {
  const existingTeam = await getTeamForAdmin(userId);
  if (existingTeam) return existingTeam;

  const team = await createTeam();
  await addTeamMember(team.id, userId, TeamMemberRole.Admin);
  return team;
}

export async function isTeamAdmin(userId: number) {
  return !!(await getTeamForAdmin(userId));
}

export async function getTeamMembers(teamId: number) {
  return db
    .select()
    .from(teamMembers)
    .where(eq(teamMembers.teamId, teamId));
}
