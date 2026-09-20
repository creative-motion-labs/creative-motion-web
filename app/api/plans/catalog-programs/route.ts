import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { catalogSessionRequiresPrescribedSide } from "@/app/lib/clinical/clinical-prescribed-side-applicability";
import type { CatalogProgramListItem } from "@/app/lib/clinical/catalog-programs-list";
import {
  loadCatalogProgramForAssignment,
  LoadCatalogProgramError,
} from "@/app/lib/rehab-programs/load-catalog-program-for-assignment";

export type { CatalogProgramListItem, CatalogProgramListSession } from "@/app/lib/clinical/catalog-programs-list";

export const CATALOG_PROGRAMS_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
} as const;

function jsonNoStore(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: CATALOG_PROGRAMS_NO_STORE_HEADERS });
}

export type CatalogProgramsGetDependencies = {
  buildClients: () => Promise<{
    sessionClient: SupabaseClient;
    adminClient: SupabaseClient;
  } | null>;
  loadCatalogProgram: typeof loadCatalogProgramForAssignment;
};

async function defaultBuildClients() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !svc) return null;

  const cookieStore = await cookies();
  const sessionClient = createServerClient(url, anon, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          /* Route Handler */
        }
      },
    },
  });
  const adminClient = createAdminClient(url, svc, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return { sessionClient, adminClient };
}

export function createCatalogProgramsGetHandler(
  deps: CatalogProgramsGetDependencies = {
    buildClients: defaultBuildClients,
    loadCatalogProgram: loadCatalogProgramForAssignment,
  },
) {
  return async function handleCatalogProgramsGet(): Promise<NextResponse> {
    const clients = await deps.buildClients();
    if (!clients) {
      return jsonNoStore({ error: "Service temporarily unavailable." }, 503);
    }

    const {
      data: { user },
      error: authErr,
    } = await clients.sessionClient.auth.getUser();
    if (authErr ?? !user) {
      return jsonNoStore({ error: "Unauthorized." }, 401);
    }

    const { data: programRows, error: listError } = await clients.adminClient
      .from("treatment_programs")
      .select("id")
      .eq("status", "published")
      .order("name", { ascending: true });

    if (listError) {
      console.error("[GET /api/plans/catalog-programs] list failed");
      return jsonNoStore({ error: "Failed to load catalog programs." }, 500);
    }

    const programs: CatalogProgramListItem[] = [];

    for (const row of programRows ?? []) {
      try {
        const loaded = await deps.loadCatalogProgram(clients.adminClient, row.id);
        programs.push({
          id: loaded.sourceTreatmentProgramId,
          name: loaded.name,
          slug: loaded.slug,
          sessions: loaded.sessions.map((session) => ({
            sessionNumber: session.sessionNumber,
            title: session.title,
            requiresPrescribedSide: catalogSessionRequiresPrescribedSide(session.blocks),
            blocks: session.blocks.map((block) => ({ movementId: block.movementId })),
          })),
        });
      } catch (err) {
        if (err instanceof LoadCatalogProgramError) {
          console.error("[GET /api/plans/catalog-programs] skip program", err.reason);
          continue;
        }
        console.error("[GET /api/plans/catalog-programs] unexpected load error");
        return jsonNoStore({ error: "Failed to load catalog programs." }, 500);
      }
    }

    return jsonNoStore({ programs }, 200);
  };
}

/**
 * GET /api/plans/catalog-programs
 * Read-only list of published catalog programs for clinician assignment UI.
 */
export const GET = createCatalogProgramsGetHandler();
