import { createClient as createAdminClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  forbiddenResponseForAccessState,
  isClinicianWorkspaceAllowed,
  resolveClinicianAccessState,
  type ProviderAccessState,
} from "../auth/provider-authorization";
import { serviceUnavailableResponse } from "./safe-errors";

export type ApprovedProviderSessionResult =
  | {
      ok: true;
      user: User;
      adminClient: SupabaseClient;
      access: Extract<ProviderAccessState, { kind: "approved" }>;
    }
  | { ok: false; response: NextResponse };

async function buildSessionAndAdminClients(): Promise<
  | {
      sessionClient: SupabaseClient;
      adminClient: SupabaseClient;
      supabaseUrl: string;
    }
  | null
> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !anonKey) return null;

  const cookieStore = await cookies();
  const sessionClient = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          /* read-only route handler context */
        }
      },
    },
  });

  const adminClient = serviceKey
    ? createAdminClient(supabaseUrl, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : sessionClient;

  return { sessionClient, adminClient, supabaseUrl };
}

/**
 * Require authenticated Supabase user with approved provider access.
 */
export async function requireApprovedProviderSession(): Promise<ApprovedProviderSessionResult> {
  const clients = await buildSessionAndAdminClients();
  if (!clients) {
    return { ok: false, response: serviceUnavailableResponse() };
  }

  const {
    data: { user },
    error,
  } = await clients.sessionClient.auth.getUser();

  if (error ?? !user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }),
    };
  }

  const access = await resolveClinicianAccessState(clients.adminClient, user.id);
  if (!isClinicianWorkspaceAllowed(access)) {
    const detail = forbiddenResponseForAccessState(access);
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Forbidden.", code: detail.code },
        { status: detail.status },
      ),
    };
  }

  if (access.kind !== "approved") {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden." }, { status: 403 }),
    };
  }

  return {
    ok: true,
    user,
    adminClient: clients.adminClient,
    access,
  };
}

/**
 * Guard for routes that already resolved session + admin clients.
 */
export async function guardApprovedProviderApiAccess(
  adminClient: SupabaseClient,
  userId: string,
): Promise<NextResponse | null> {
  const access = await resolveClinicianAccessState(adminClient, userId);
  if (isClinicianWorkspaceAllowed(access)) return null;
  const detail = forbiddenResponseForAccessState(access);
  return NextResponse.json(
    { error: "Forbidden.", code: detail.code },
    { status: detail.status },
  );
}
