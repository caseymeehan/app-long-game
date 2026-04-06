import { useState, useEffect } from "react";
import { useFetcher } from "react-router";
import { toast } from "sonner";
import { z } from "zod";
import type { Route } from "./+types/admin.partners";
import {
  getAllPartners,
  createPartner,
  updatePartner,
  togglePartnerActive,
  getPartnerByUserId,
} from "~/services/partnerService";
import { getAllUsers, getUserByEmail } from "~/services/userService";
import { requireAdmin } from "~/lib/session";
import { parseFormData } from "~/lib/validation";
import { getSupabaseAdmin } from "~/lib/supabase-admin.server";
import { waitForAppUser } from "~/lib/wait-for-user";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Skeleton } from "~/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  AlertTriangle,
  CheckCircle2,
  Handshake,
  Pencil,
  Plus,
  Save,
  UserPlus,
  X,
  XCircle,
} from "lucide-react";
import { data, isRouteErrorResponse } from "react-router";

const adminPartnerActionSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("create-partner"),
    userId: z.coerce.number().int(),
    affiliateId: z.string().trim().min(1, "Affiliate ID is required."),
    commissionTier: z.string().trim().optional(),
    notes: z.string().trim().optional(),
  }),
  z.object({
    intent: z.literal("create-partner-new-user"),
    name: z.string().trim().min(1, "Name is required."),
    email: z.string().email("Valid email is required."),
    affiliateId: z.string().trim().min(1, "Affiliate ID is required."),
    commissionTier: z.string().trim().optional(),
    notes: z.string().trim().optional(),
  }),
  z.object({
    intent: z.literal("update-partner"),
    partnerId: z.coerce.number().int(),
    affiliateId: z.string().trim().min(1, "Affiliate ID is required."),
    commissionTier: z.string().trim().optional(),
    notes: z.string().trim().optional(),
  }),
  z.object({
    intent: z.literal("toggle-active"),
    partnerId: z.coerce.number().int(),
  }),
]);

export function meta() {
  return [
    { title: "Manage Partners — Long-Game" },
    { name: "description", content: "Manage affiliate partners" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);

  const partners = await getAllPartners();
  const allUsers = await getAllUsers();

  // Users available for linking (not already partners)
  const partnerUserIds = new Set(partners.map((p) => p.userId));
  const availableUsers = allUsers.filter((u) => !partnerUserIds.has(u.id));

  return { partners, availableUsers };
}

export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request, "action");

  const formData = await request.formData();
  const parsed = parseFormData(formData, adminPartnerActionSchema);

  if (!parsed.success) {
    return data(
      { error: Object.values(parsed.errors)[0] ?? "Invalid input." },
      { status: 400 }
    );
  }

  const { intent } = parsed.data;

  if (intent === "create-partner") {
    const { userId, affiliateId, commissionTier, notes } = parsed.data;
    const existing = await getPartnerByUserId(userId);
    if (existing) {
      return data({ error: "This user is already a partner." }, { status: 400 });
    }
    await createPartner({ userId, affiliateId, commissionTier: commissionTier ?? null, notes: notes ?? null });
    return { success: true };
  }

  if (intent === "create-partner-new-user") {
    const { name, email, affiliateId, commissionTier, notes } = parsed.data;

    // Check if user already exists in our app
    const existingAppUser = await getUserByEmail(email);
    if (existingAppUser) {
      const existingPartner = await getPartnerByUserId(existingAppUser.id);
      if (existingPartner) {
        return data({ error: "This email is already a partner." }, { status: 400 });
      }
      // User exists but isn't a partner — link them
      await createPartner({ userId: existingAppUser.id, affiliateId, commissionTier: commissionTier ?? null, notes: notes ?? null });
      return { success: true };
    }

    // Create Supabase auth user (same pattern as ThriveCart webhook)
    const supabaseAdmin = getSupabaseAdmin();
    const { error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { name },
    });

    if (createError && !createError.message?.includes("already") && createError.status !== 422) {
      return data({ error: `Failed to create user: ${createError.message}` }, { status: 500 });
    }

    // Wait for DB trigger to create app user
    const appUser = await waitForAppUser(email);
    if (!appUser) {
      return data({ error: "App user not created after retries." }, { status: 500 });
    }

    // Create partner record
    await createPartner({ userId: appUser.id, affiliateId, commissionTier: commissionTier ?? null, notes: notes ?? null });

    // Send magic link for initial login
    const { error: otpError } = await supabaseAdmin.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${process.env.SUPABASE_URL ? "https://app.long-game.ai" : "http://localhost:3000"}/auth/callback`,
      },
    });

    if (otpError) {
      console.error(`[admin.partners] Failed to send magic link: ${otpError.message}`);
    }

    return { success: true };
  }

  if (intent === "update-partner") {
    const { partnerId, affiliateId, commissionTier, notes } = parsed.data;
    await updatePartner({ id: partnerId, affiliateId, commissionTier: commissionTier ?? null, notes: notes ?? null });
    return { success: true };
  }

  if (intent === "toggle-active") {
    const { partnerId } = parsed.data;
    await togglePartnerActive(partnerId);
    return { success: true };
  }

  throw data("Invalid action.", { status: 400 });
}

export function HydrateFallback() {
  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <Skeleton className="mb-6 h-9 w-64" />
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    </div>
  );
}

export default function AdminPartners({ loaderData }: Route.ComponentProps) {
  const { partners, availableUsers } = loaderData;
  const [showNewPartnerForm, setShowNewPartnerForm] = useState(false);
  const [createMode, setCreateMode] = useState<"existing" | "new">("existing");

  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Partners</h1>
          <p className="text-sm text-muted-foreground">
            Manage affiliate partners and their details.
          </p>
        </div>
        <Button onClick={() => setShowNewPartnerForm(!showNewPartnerForm)}>
          <Plus className="mr-2 size-4" />
          Add Partner
        </Button>
      </div>

      {showNewPartnerForm && (
        <Card className="mb-6">
          <CardHeader>
            <h2 className="text-lg font-semibold">Add New Partner</h2>
            <div className="flex gap-2">
              <Button
                variant={createMode === "existing" ? "default" : "outline"}
                size="sm"
                onClick={() => setCreateMode("existing")}
              >
                Link Existing User
              </Button>
              <Button
                variant={createMode === "new" ? "default" : "outline"}
                size="sm"
                onClick={() => setCreateMode("new")}
              >
                <UserPlus className="mr-1.5 size-4" />
                Create New User
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {createMode === "existing" ? (
              <CreatePartnerFromExisting
                availableUsers={availableUsers}
                onDone={() => setShowNewPartnerForm(false)}
              />
            ) : (
              <CreatePartnerNewUser
                onDone={() => setShowNewPartnerForm(false)}
              />
            )}
          </CardContent>
        </Card>
      )}

      {partners.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Handshake className="mx-auto mb-3 size-12 opacity-50" />
            <p>No partners yet. Add your first partner above.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {partners.map((partner) => (
            <PartnerRow key={partner.id} partner={partner} />
          ))}
        </div>
      )}
    </div>
  );
}

function CreatePartnerFromExisting({
  availableUsers,
  onDone,
}: {
  availableUsers: Array<{ id: number; name: string; email: string }>;
  onDone: () => void;
}) {
  const fetcher = useFetcher();
  const [selectedUserId, setSelectedUserId] = useState("");
  const [affiliateId, setAffiliateId] = useState("");
  const [commissionTier, setCommissionTier] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      toast.success("Partner created.");
      onDone();
    }
    if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(fetcher.data.error);
    }
  }, [fetcher.state, fetcher.data, onDone]);

  return (
    <fetcher.Form method="post" className="space-y-4">
      <input type="hidden" name="intent" value="create-partner" />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="userId">User</Label>
          <Select
            name="userId"
            value={selectedUserId}
            onValueChange={setSelectedUserId}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a user..." />
            </SelectTrigger>
            <SelectContent>
              {availableUsers.map((user) => (
                <SelectItem key={user.id} value={String(user.id)}>
                  {user.name} ({user.email})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="affiliateId">ThriveCart Affiliate ID</Label>
          <Input
            name="affiliateId"
            value={affiliateId}
            onChange={(e) => setAffiliateId(e.target.value)}
            placeholder="e.g. partner123"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="commissionTier">Commission Tier</Label>
          <Input
            name="commissionTier"
            value={commissionTier}
            onChange={(e) => setCommissionTier(e.target.value)}
            placeholder="e.g. standard, premium"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="notes">Notes</Label>
          <Input
            name="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Internal notes..."
          />
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          type="submit"
          disabled={!selectedUserId || !affiliateId || fetcher.state !== "idle"}
        >
          <Save className="mr-2 size-4" />
          {fetcher.state !== "idle" ? "Creating..." : "Create Partner"}
        </Button>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </fetcher.Form>
  );
}

function CreatePartnerNewUser({ onDone }: { onDone: () => void }) {
  const fetcher = useFetcher();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [affiliateId, setAffiliateId] = useState("");
  const [commissionTier, setCommissionTier] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      toast.success("Partner created and magic link sent.");
      onDone();
    }
    if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(fetcher.data.error);
    }
  }, [fetcher.state, fetcher.data, onDone]);

  return (
    <fetcher.Form method="post" className="space-y-4">
      <input type="hidden" name="intent" value="create-partner-new-user" />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Partner name"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            name="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="partner@example.com"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="affiliateId">ThriveCart Affiliate ID</Label>
          <Input
            name="affiliateId"
            value={affiliateId}
            onChange={(e) => setAffiliateId(e.target.value)}
            placeholder="e.g. partner123"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="commissionTier">Commission Tier</Label>
          <Input
            name="commissionTier"
            value={commissionTier}
            onChange={(e) => setCommissionTier(e.target.value)}
            placeholder="e.g. standard, premium"
          />
        </div>
        <div className="sm:col-span-2 space-y-2">
          <Label htmlFor="notes">Notes</Label>
          <Input
            name="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Internal notes..."
          />
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        A new user account will be created and a magic link email will be sent for initial login.
      </p>
      <div className="flex gap-2">
        <Button
          type="submit"
          disabled={!name || !email || !affiliateId || fetcher.state !== "idle"}
        >
          <UserPlus className="mr-2 size-4" />
          {fetcher.state !== "idle" ? "Creating..." : "Create User & Partner"}
        </Button>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </fetcher.Form>
  );
}

function PartnerRow({
  partner,
}: {
  partner: {
    id: number;
    userId: number;
    affiliateId: string;
    commissionTier: string | null;
    isActive: boolean;
    notes: string | null;
    createdAt: string;
    userName: string;
    userEmail: string;
  };
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [affiliateId, setAffiliateId] = useState(partner.affiliateId);
  const [commissionTier, setCommissionTier] = useState(partner.commissionTier ?? "");
  const [notes, setNotes] = useState(partner.notes ?? "");
  const updateFetcher = useFetcher();
  const toggleFetcher = useFetcher();

  useEffect(() => {
    if (updateFetcher.state === "idle" && updateFetcher.data?.success) {
      toast.success("Partner updated.");
      setIsEditing(false);
    }
    if (updateFetcher.state === "idle" && updateFetcher.data?.error) {
      toast.error(updateFetcher.data.error);
    }
  }, [updateFetcher.state, updateFetcher.data]);

  useEffect(() => {
    if (toggleFetcher.state === "idle" && toggleFetcher.data?.success) {
      toast.success(partner.isActive ? "Partner deactivated." : "Partner activated.");
    }
  }, [toggleFetcher.state, toggleFetcher.data, partner.isActive]);

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium">{partner.userName}</span>
              <span className="text-sm text-muted-foreground">
                {partner.userEmail}
              </span>
              {partner.isActive ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900 dark:text-green-300">
                  <CheckCircle2 className="size-3" />
                  Active
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900 dark:text-red-300">
                  <XCircle className="size-3" />
                  Inactive
                </span>
              )}
            </div>

            {isEditing ? (
              <updateFetcher.Form method="post" className="mt-3 space-y-3">
                <input type="hidden" name="intent" value="update-partner" />
                <input type="hidden" name="partnerId" value={partner.id} />
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Affiliate ID</Label>
                    <Input
                      name="affiliateId"
                      value={affiliateId}
                      onChange={(e) => setAffiliateId(e.target.value)}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Commission Tier</Label>
                    <Input
                      name="commissionTier"
                      value={commissionTier}
                      onChange={(e) => setCommissionTier(e.target.value)}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Notes</Label>
                    <Input
                      name="notes"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="h-8 text-sm"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={updateFetcher.state !== "idle"}>
                    <Save className="mr-1.5 size-3.5" />
                    Save
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setIsEditing(false);
                      setAffiliateId(partner.affiliateId);
                      setCommissionTier(partner.commissionTier ?? "");
                      setNotes(partner.notes ?? "");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </updateFetcher.Form>
            ) : (
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span>
                  Affiliate: <span className="font-mono text-foreground">{partner.affiliateId}</span>
                </span>
                {partner.commissionTier && (
                  <span>Tier: {partner.commissionTier}</span>
                )}
                {partner.notes && (
                  <span className="truncate max-w-48" title={partner.notes}>
                    {partner.notes}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => setIsEditing(!isEditing)}
              title="Edit partner"
            >
              <Pencil className="size-3.5" />
            </Button>
            <toggleFetcher.Form method="post">
              <input type="hidden" name="intent" value="toggle-active" />
              <input type="hidden" name="partnerId" value={partner.id} />
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                type="submit"
                title={partner.isActive ? "Deactivate partner" : "Activate partner"}
              >
                {partner.isActive ? (
                  <XCircle className="size-3.5 text-red-500" />
                ) : (
                  <CheckCircle2 className="size-3.5 text-green-500" />
                )}
              </Button>
            </toggleFetcher.Form>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 403) {
      title = "Access denied";
      message = typeof error.data === "string" ? error.data : "You don't have permission.";
    } else {
      title = `Error ${error.status}`;
      message = typeof error.data === "string" ? error.data : error.statusText;
    }
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}
