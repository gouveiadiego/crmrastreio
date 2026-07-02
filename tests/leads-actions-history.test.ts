import { describe, expect, test, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/guards", () => ({
  requireOrgMember: vi.fn(),
  requireOrgRole: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => Promise.resolve(fn()) }));

import { createClient } from "@/lib/supabase/server";
import { requireOrgMember } from "@/lib/auth/guards";
import { createLeadAction, moveLeadAction } from "@/lib/leads/actions";

const mockedCreate = createClient as unknown as ReturnType<typeof vi.fn>;
const mockedMember = requireOrgMember as unknown as ReturnType<typeof vi.fn>;

const ORG_ID = "00000000-0000-0000-0000-000000000000";
const LEAD_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const STAGE_FROM = "12345678-1234-4000-8000-000000000001";
const STAGE_TO = "12345678-1234-4000-8000-000000000002";

function makeSupabase(opts: {
  stage?: { id: string; meta_event: string | null; requires_value: boolean } | null;
  lead?: { id: string; phone: string | null; name: string | null; funnel_stage_id: string } | null;
  insertLeadResult?: { id: string } | null;
}) {
  const historyInserts: Record<string, unknown>[] = [];

  const from = vi.fn((table: string) => {
    if (table === "funnel_stages") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: opts.stage ?? null }),
            }),
          }),
        }),
      };
    }
    if (table === "leads") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: opts.lead ?? null }),
            }),
          }),
        }),
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: opts.insertLeadResult ?? null,
              error: opts.insertLeadResult ? null : new Error("insert fail"),
            }),
          }),
        }),
        update: () => ({
          eq: () => ({
            eq: async () => ({ error: null }),
          }),
        }),
      };
    }
    if (table === "lead_stage_history") {
      return {
        insert: (row: Record<string, unknown>) => {
          historyInserts.push(row);
          return Promise.resolve({ error: null });
        },
      };
    }
    return {};
  });

  return { supabase: { from } as never, historyInserts };
}

describe("createLeadAction — grava histórico de etapa", () => {
  beforeEach(() => {
    mockedCreate.mockReset();
    mockedMember.mockReset();
  });

  test("grava entrada inicial no histórico com from_stage_id null", async () => {
    mockedMember.mockResolvedValue({ org: { id: ORG_ID } });
    const { supabase, historyInserts } = makeSupabase({ insertLeadResult: { id: LEAD_ID } });
    mockedCreate.mockResolvedValue(supabase);

    const result = await createLeadAction({
      orgSlug: "acme",
      funnel_stage_id: STAGE_TO,
      name: "Ana",
      phone: "+5511999990000",
    });

    expect(result.ok).toBe(true);
    expect(historyInserts).toHaveLength(1);
    expect(historyInserts[0]).toMatchObject({
      organization_id: ORG_ID,
      lead_id: LEAD_ID,
      from_stage_id: null,
      to_stage_id: STAGE_TO,
    });
  });
});

describe("moveLeadAction — grava histórico de etapa", () => {
  beforeEach(() => {
    mockedCreate.mockReset();
    mockedMember.mockReset();
  });

  test("grava transição com from_stage_id da etapa anterior", async () => {
    mockedMember.mockResolvedValue({ org: { id: ORG_ID } });
    const { supabase, historyInserts } = makeSupabase({
      stage: { id: STAGE_TO, meta_event: null, requires_value: false },
      lead: { id: LEAD_ID, phone: "+5511999990000", name: "Ana", funnel_stage_id: STAGE_FROM },
    });
    mockedCreate.mockResolvedValue(supabase);

    const result = await moveLeadAction({
      orgSlug: "acme",
      leadId: LEAD_ID,
      newStageId: STAGE_TO,
    });

    expect(result.ok).toBe(true);
    expect(historyInserts).toHaveLength(1);
    expect(historyInserts[0]).toMatchObject({
      organization_id: ORG_ID,
      lead_id: LEAD_ID,
      from_stage_id: STAGE_FROM,
      to_stage_id: STAGE_TO,
    });
  });
});
