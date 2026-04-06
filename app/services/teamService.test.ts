import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, cleanDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: Awaited<ReturnType<typeof seedBaseData>>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

// Import after mock so the module picks up our test db
import {
  createTeam,
  addTeamMember,
  getTeamForAdmin,
  getOrCreateTeamForUser,
  isTeamAdmin,
  getTeamMembers,
} from "./teamService";

describe("teamService", () => {
  beforeEach(async () => {
    testDb = createTestDb();
    await cleanDb(testDb);
    base = await seedBaseData(testDb);
  });

  describe("createTeam", () => {
    it("creates a team and returns it", async () => {
      const team = await createTeam();

      expect(team).toBeDefined();
      expect(team.id).toBeDefined();
      expect(team.createdAt).toBeDefined();
    });
  });

  describe("addTeamMember", () => {
    it("adds a user as an admin", async () => {
      const team = await createTeam();
      const member = await addTeamMember(
        team.id,
        base.user.id,
        schema.TeamMemberRole.Admin
      );

      expect(member).toBeDefined();
      expect(member.teamId).toBe(team.id);
      expect(member.userId).toBe(base.user.id);
      expect(member.role).toBe(schema.TeamMemberRole.Admin);
    });

    it("adds a user as a member", async () => {
      const team = await createTeam();
      const member = await addTeamMember(
        team.id,
        base.user.id,
        schema.TeamMemberRole.Member
      );

      expect(member.role).toBe(schema.TeamMemberRole.Member);
    });
  });

  describe("getTeamForAdmin", () => {
    it("returns the team when user is an admin", async () => {
      const team = await createTeam();
      await addTeamMember(team.id, base.user.id, schema.TeamMemberRole.Admin);

      const found = await getTeamForAdmin(base.user.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(team.id);
    });

    it("returns undefined when user is a member but not admin", async () => {
      const team = await createTeam();
      await addTeamMember(team.id, base.user.id, schema.TeamMemberRole.Member);

      const found = await getTeamForAdmin(base.user.id);
      expect(found).toBeUndefined();
    });

    it("returns undefined when user has no team", async () => {
      const found = await getTeamForAdmin(base.user.id);
      expect(found).toBeUndefined();
    });
  });

  describe("getOrCreateTeamForUser", () => {
    it("creates a new team and makes user admin", async () => {
      const team = await getOrCreateTeamForUser(base.user.id);

      expect(team).toBeDefined();
      expect(team.id).toBeDefined();

      // Verify user is admin of the team
      const members = await getTeamMembers(team.id);
      expect(members).toHaveLength(1);
      expect(members[0].userId).toBe(base.user.id);
      expect(members[0].role).toBe(schema.TeamMemberRole.Admin);
    });

    it("returns existing team on subsequent calls (team is reused)", async () => {
      const team1 = await getOrCreateTeamForUser(base.user.id);
      const team2 = await getOrCreateTeamForUser(base.user.id);

      expect(team1.id).toBe(team2.id);

      // Verify only one membership exists (not duplicated)
      const members = await getTeamMembers(team1.id);
      expect(members).toHaveLength(1);
    });
  });

  describe("isTeamAdmin", () => {
    it("returns true when user is a team admin", async () => {
      await getOrCreateTeamForUser(base.user.id);

      expect(await isTeamAdmin(base.user.id)).toBe(true);
    });

    it("returns false when user is a regular member", async () => {
      const team = await createTeam();
      await addTeamMember(team.id, base.user.id, schema.TeamMemberRole.Member);

      expect(await isTeamAdmin(base.user.id)).toBe(false);
    });

    it("returns false when user has no team", async () => {
      expect(await isTeamAdmin(base.user.id)).toBe(false);
    });
  });

  describe("getTeamMembers", () => {
    it("returns all members of a team", async () => {
      const team = await createTeam();
      await addTeamMember(team.id, base.user.id, schema.TeamMemberRole.Admin);
      await addTeamMember(team.id, base.instructor.id, schema.TeamMemberRole.Member);

      const members = await getTeamMembers(team.id);
      expect(members).toHaveLength(2);
    });

    it("returns empty array for a team with no members", async () => {
      const team = await createTeam();

      const members = await getTeamMembers(team.id);
      expect(members).toHaveLength(0);
    });
  });
});
