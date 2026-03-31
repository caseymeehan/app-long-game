import {
  createServerClient,
  parseCookieHeader,
  serializeCookieHeader,
} from "@supabase/ssr";

export function createSupabaseServerClient(
  request: Request,
  responseHeaders: Headers
) {
  return createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return parseCookieHeader(request.headers.get("Cookie") ?? "").filter(
            (c): c is { name: string; value: string } => c.value !== undefined
          );
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            responseHeaders.append(
              "Set-Cookie",
              serializeCookieHeader(name, value, options)
            );
          }
        },
      },
    }
  );
}
