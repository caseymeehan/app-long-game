import { eq } from "drizzle-orm";
import { db } from "~/db";
import { partners, users } from "~/db/schema";

// ─── Partner Service ───
// Handles partner CRUD and status checks.

export async function getPartnerByUserId(userId: number) {
  const [row] = await db
    .select()
    .from(partners)
    .where(eq(partners.userId, userId));
  return row;
}

export async function getPartnerByAffiliateId(affiliateId: string) {
  const [row] = await db
    .select()
    .from(partners)
    .where(eq(partners.affiliateId, affiliateId));
  return row;
}

export async function isActivePartner(userId: number): Promise<boolean> {
  const partner = await getPartnerByUserId(userId);
  return !!partner?.isActive;
}

export async function getAllPartners() {
  return await db
    .select({
      id: partners.id,
      userId: partners.userId,
      affiliateId: partners.affiliateId,
      commissionTier: partners.commissionTier,
      isActive: partners.isActive,
      notes: partners.notes,
      createdAt: partners.createdAt,
      userName: users.name,
      userEmail: users.email,
    })
    .from(partners)
    .innerJoin(users, eq(partners.userId, users.id))
    .orderBy(partners.createdAt);
}

export async function createPartner(opts: {
  userId: number;
  affiliateId: string;
  commissionTier: string | null;
  notes: string | null;
}) {
  const { userId, affiliateId, commissionTier, notes } = opts;
  const [row] = await db
    .insert(partners)
    .values({ userId, affiliateId, commissionTier, notes })
    .returning();
  return row;
}

export async function updatePartner(opts: {
  id: number;
  affiliateId: string;
  commissionTier: string | null;
  notes: string | null;
}) {
  const { id, affiliateId, commissionTier, notes } = opts;
  const [row] = await db
    .update(partners)
    .set({ affiliateId, commissionTier, notes })
    .where(eq(partners.id, id))
    .returning();
  return row;
}

export async function togglePartnerActive(id: number) {
  const [current] = await db
    .select({ isActive: partners.isActive })
    .from(partners)
    .where(eq(partners.id, id));
  if (!current) return null;

  const [row] = await db
    .update(partners)
    .set({ isActive: !current.isActive })
    .where(eq(partners.id, id))
    .returning();
  return row;
}
