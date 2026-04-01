import type { Route } from "./+types/api.thrivecart-webhook";
import { getSupabaseAdmin } from "~/lib/supabase-admin.server";
import {
  getUserByEmail,
  createUserWithAuth,
  linkSupabaseAuth,
} from "~/services/userService";
import {
  createPurchase,
  findPurchaseByThrivecartOrderId,
  markPurchaseRefunded,
} from "~/services/purchaseService";
import {
  enrollUser,
  findEnrollment,
  unenrollUser,
} from "~/services/enrollmentService";
import { UserRole } from "~/db/schema";

// ThriveCart sends HEAD to verify the endpoint exists
export async function loader({ request }: Route.LoaderArgs) {
  return new Response("OK", { status: 200 });
}

export async function action({ request }: Route.ActionArgs) {
  const secret = process.env.THRIVECART_SECRET;
  const courseId = parseInt(process.env.THRIVECART_COURSE_ID || "1", 10);

  if (!secret) {
    console.error("[thrivecart-webhook] THRIVECART_SECRET not configured");
    return new Response("Server misconfigured", { status: 500 });
  }

  // Parse URL-encoded body with bracket-notation keys
  const text = await request.text();
  const params = new URLSearchParams(text);

  // Validate secret
  const payloadSecret = params.get("thrivecart_secret");
  if (payloadSecret !== secret) {
    console.error("[thrivecart-webhook] Invalid secret");
    return new Response("Unauthorized", { status: 401 });
  }

  const event = params.get("event");
  console.log(`[thrivecart-webhook] Received event: ${event}`);

  switch (event) {
    case "order.success":
      return handleOrderSuccess(params, courseId);
    case "order.refund":
      return handleOrderRefund(params, courseId);
    default:
      console.log(`[thrivecart-webhook] Ignoring unhandled event: ${event}`);
      return new Response("OK", { status: 200 });
  }
}

async function handleOrderSuccess(params: URLSearchParams, courseId: number) {
  const orderId = params.get("order_id");
  const email = params.get("customer[email]")?.toLowerCase().trim();
  const firstName = params.get("customer[first_name]") || "";
  const lastName = params.get("customer[last_name]") || "";
  const totalStr = params.get("order[0][total]") || "0";
  const affiliateId = params.get("affiliate[id]") || undefined;

  if (!email) {
    console.error("[thrivecart-webhook] order.success missing customer email");
    return new Response("Missing customer email", { status: 400 });
  }

  if (!orderId) {
    console.error("[thrivecart-webhook] order.success missing order_id");
    return new Response("Missing order_id", { status: 400 });
  }

  // Idempotency: check if we already processed this order
  const existingPurchase = await findPurchaseByThrivecartOrderId(orderId);
  if (existingPurchase) {
    console.log(`[thrivecart-webhook] Order ${orderId} already processed, skipping`);
    return new Response("OK", { status: 200 });
  }

  const supabaseAdmin = getSupabaseAdmin();
  const name = `${firstName} ${lastName}`.trim() || email.split("@")[0];

  // 1. Find or create Supabase auth user
  let supabaseAuthId: string;

  const { data: createData, error: createError } =
    await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: true,
    });

  if (createError) {
    if (createError.message?.includes("already been registered")) {
      // User exists in Supabase auth — find them
      const { data: listData } = await supabaseAdmin.auth.admin.listUsers();
      const existingAuthUser = listData?.users?.find(
        (u) => u.email?.toLowerCase() === email
      );
      if (!existingAuthUser) {
        console.error(`[thrivecart-webhook] Could not find existing auth user for ${email}`);
        return new Response("Failed to find auth user", { status: 500 });
      }
      supabaseAuthId = existingAuthUser.id;
    } else {
      console.error(`[thrivecart-webhook] Failed to create auth user: ${createError.message}`);
      return new Response("Failed to create auth user", { status: 500 });
    }
  } else {
    supabaseAuthId = createData.user.id;
  }

  // 2. Find or create app user
  let appUser = await getUserByEmail(email);

  if (!appUser) {
    appUser = await createUserWithAuth(name, email, UserRole.Student, supabaseAuthId);
    console.log(`[thrivecart-webhook] Created app user ${appUser.id} for ${email}`);
  } else if (!appUser.supabaseAuthId) {
    // Link Supabase auth to existing app user
    appUser = await linkSupabaseAuth(appUser.id, supabaseAuthId);
    console.log(`[thrivecart-webhook] Linked auth to existing user ${appUser.id}`);
  }

  // 3. Create purchase record
  const pricePaid = parseInt(totalStr, 10) || 0;
  await createPurchase(appUser.id, courseId, pricePaid, null, orderId, affiliateId);
  console.log(`[thrivecart-webhook] Created purchase for order ${orderId}`);

  // 4. Enroll user (skip if already enrolled)
  const existing = await findEnrollment(appUser.id, courseId);
  if (!existing) {
    await enrollUser(appUser.id, courseId, false, true);
    console.log(`[thrivecart-webhook] Enrolled user ${appUser.id} in course ${courseId}`);
  }

  // 5. Send magic link email
  const { error: otpError } = await supabaseAdmin.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${process.env.SUPABASE_URL ? "https://app.long-game.ai" : "http://localhost:3000"}/auth/callback`,
    },
  });

  if (otpError) {
    console.error(`[thrivecart-webhook] Failed to send magic link: ${otpError.message}`);
    // Don't fail the webhook — account and enrollment are created, user can log in manually
  } else {
    console.log(`[thrivecart-webhook] Magic link sent to ${email}`);
  }

  return new Response("OK", { status: 200 });
}

async function handleOrderRefund(params: URLSearchParams, courseId: number) {
  const orderId = params.get("order_id");
  const email = params.get("customer[email]")?.toLowerCase().trim();

  if (!orderId) {
    console.error("[thrivecart-webhook] order.refund missing order_id");
    return new Response("OK", { status: 200 }); // Don't retry
  }

  // Mark purchase as refunded
  const purchase = await findPurchaseByThrivecartOrderId(orderId);
  if (purchase) {
    await markPurchaseRefunded(purchase.id);
    console.log(`[thrivecart-webhook] Marked purchase ${purchase.id} as refunded`);
  } else {
    console.warn(`[thrivecart-webhook] No purchase found for order ${orderId}`);
  }

  // Revoke enrollment
  if (email) {
    const appUser = await getUserByEmail(email);
    if (appUser) {
      try {
        await unenrollUser(appUser.id, courseId);
        console.log(`[thrivecart-webhook] Unenrolled user ${appUser.id} from course ${courseId}`);
      } catch {
        // User may not be enrolled — that's fine
        console.log(`[thrivecart-webhook] User ${appUser.id} was not enrolled, nothing to revoke`);
      }
    }
  }

  return new Response("OK", { status: 200 });
}
