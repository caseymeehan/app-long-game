# Archived routes

These route files were removed from the live app on **2026-06-06**. They are kept
here (tracked in git) for potential future revival, but are **not registered** in
`app/routes.ts`, so they are unreachable in production (any request 404s).

This directory is excluded from TypeScript compilation via `tsconfig.json`
(`"exclude": ["app/_archived/**"]`) — the files still reference generated
`./+types/...` modules that only exist for registered routes, so they will not
typecheck as-is. That's expected for archived code.

## Why these were archived

All real enrollment flows through ThriveCart (`app/routes/api.thrivecart-webhook.ts`).
Casey has never used in-app self-purchase, team purchases, or coupons. The
self-purchase route in particular was a latent exposure: its `confirm-purchase`
action granted course enrollment with **no payment step**, so any signed-up user
who hit the URL could enroll for free (it was not linked from any course page, but
the handler was live).

## What's here

- `routes/courses.$slug.purchase.tsx` — in-app "Confirm Purchase" (self + team).
  Granted enrollment with no payment. Was only linked from `team.tsx`.
- `routes/team.tsx` — team dashboard (coupon list, "buy more seats"). Not in nav.
- `routes/redeem.$code.tsx` — coupon claim page. Codes only ever came from team
  purchases, of which there were none.

### Added 2026-06-06 (OTP login migration, commit `61a9f48` onward)

- `routes/signup.tsx` — self-serve account creation (password + magic-link). Was
  **orphaned** (nothing in the app linked to it; login has no signup link) and
  predated the ThriveCart-only model. Its magic-link option also broke when login
  moved to 6-digit OTP codes: the global email template now sends a code, but this
  page still said "click the link" with no code-entry screen.
- `routes/auth.callback.ts` — PKCE magic-link callback (`exchangeCodeForSession`).
  Retired because logins now use OTP codes (`verifyOtp` on `/forgot-password`, no
  link), so nothing generates a link that lands here. Its only remaining caller was
  `signup.tsx` (also archived). The shared post-login routing it used lives on in
  `app/lib/post-login.server.ts`, still used by `/forgot-password`. Note: this
  removes the `auth_failure:code_exchange` Sentry capture — acceptable since all
  users are on the OTP flow and no real traffic hits the callback.

## Related dead code still in the live tree (intentionally left in place)

The services these routes used remain under `app/services/` as inert, unreferenced
code (no live route calls them): `teamService.ts`, the coupon functions in
`couponService.ts`, and `createTeamPurchase` in `purchaseService.ts`. They were
left rather than extracted because `purchaseService.ts` also holds the
ThriveCart-critical `createPurchase` / `findPurchaseByThrivecartOrderId` /
`markPurchaseRefunded`, and surgically splitting it carries more risk than the
dead exports do. The `coupons` / `teams` / `team_members` DB tables are untouched.

## To restore a route

1. Move the file back to `app/routes/`.
2. Re-add its `route(...)` entry in `app/routes.ts`.
3. Run `pnpm typecheck` — the `./+types/...` import will regenerate once registered.
4. **Before re-enabling `courses.$slug.purchase.tsx`, add a real payment gate** to
   its `confirm-purchase` action, or it reintroduces the free-enroll hole.
