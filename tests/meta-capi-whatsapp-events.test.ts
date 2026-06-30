import { buildCapiWhatsappPayload } from "@/lib/meta-capi/whatsapp-events";
import { describe, expect, it } from "vitest";

const BASE_OPTS = {
  conversationId: "conv-abc-123",
  phone: "+5511987654321",
  name: "João Silva",
  tracking: null,
};

describe("buildCapiWhatsappPayload", () => {
  it("monta event_name e event_id corretos para Lead", () => {
    const payload = buildCapiWhatsappPayload("Lead", BASE_OPTS) as Record<string, unknown>;
    expect(payload.event_name).toBe("Lead");
    expect(payload.event_id).toBe("wpp_lead_conv-abc-123");
    expect(payload.action_source).toBe("system_generated");
    expect(typeof payload.event_time).toBe("number");
  });

  it("monta event_name e event_id corretos para Contact", () => {
    const payload = buildCapiWhatsappPayload("Contact", BASE_OPTS) as Record<string, unknown>;
    expect(payload.event_name).toBe("Contact");
    expect(payload.event_id).toBe("wpp_contact_conv-abc-123");
  });

  it("inclui hash SHA-256 de telefone em user_data.ph", () => {
    const payload = buildCapiWhatsappPayload("Lead", BASE_OPTS) as Record<string, unknown>;
    const ud = payload.user_data as Record<string, unknown>;
    expect(Array.isArray(ud.ph)).toBe(true);
    expect((ud.ph as string[])[0]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("inclui hash SHA-256 de nome em user_data.fn", () => {
    const payload = buildCapiWhatsappPayload("Lead", BASE_OPTS) as Record<string, unknown>;
    const ud = payload.user_data as Record<string, unknown>;
    expect(Array.isArray(ud.fn)).toBe(true);
    expect((ud.fn as string[])[0]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("inclui external_id como hash SHA-256 do conversationId", () => {
    const payload = buildCapiWhatsappPayload("Lead", BASE_OPTS) as Record<string, unknown>;
    const ud = payload.user_data as Record<string, unknown>;
    expect(Array.isArray(ud.external_id)).toBe(true);
    expect((ud.external_id as string[])[0]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("inclui fbc cru (não hasheado) quando tracking.fbc presente", () => {
    const payload = buildCapiWhatsappPayload("Lead", {
      ...BASE_OPTS,
      tracking: { fbc: "fb.1.1719619200.AZrXXX" },
    }) as Record<string, unknown>;
    const ud = payload.user_data as Record<string, unknown>;
    expect(ud.fbc).toBe("fb.1.1719619200.AZrXXX");
  });

  it("não inclui fbc quando tracking é null", () => {
    const payload = buildCapiWhatsappPayload("Lead", BASE_OPTS) as Record<string, unknown>;
    const ud = payload.user_data as Record<string, unknown>;
    expect(ud.fbc).toBeUndefined();
  });

  it("inclui hash SHA-256 de email quando tracking.em presente", () => {
    const payload = buildCapiWhatsappPayload("Lead", {
      ...BASE_OPTS,
      tracking: { em: "test@example.com" },
    }) as Record<string, unknown>;
    const ud = payload.user_data as Record<string, unknown>;
    expect(Array.isArray(ud.em)).toBe(true);
    expect((ud.em as string[])[0]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("funciona sem telefone e sem nome (apenas external_id)", () => {
    const payload = buildCapiWhatsappPayload("Lead", {
      ...BASE_OPTS,
      phone: null,
      name: null,
    }) as Record<string, unknown>;
    const ud = payload.user_data as Record<string, unknown>;
    expect(ud.ph).toBeUndefined();
    expect(ud.fn).toBeUndefined();
    expect(ud.external_id).toBeDefined();
  });

  it("inclui client_ip_address quando tracking.client_ip presente", () => {
    const payload = buildCapiWhatsappPayload("Lead", {
      ...BASE_OPTS,
      tracking: { client_ip: "177.100.200.50" },
    }) as Record<string, unknown>;
    const ud = payload.user_data as Record<string, unknown>;
    expect(ud.client_ip_address).toBe("177.100.200.50");
  });
});
