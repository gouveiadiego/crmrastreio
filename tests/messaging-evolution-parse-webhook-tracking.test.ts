import { parseWebhook } from "@/lib/messaging/adapters/whatsapp-evolution/parse-webhook";
import { describe, expect, it } from "vitest";

const BASE_UPSERT = {
  event: "messages.upsert",
  instance: "test-instance",
  data: {
    key: { remoteJid: "5511999999999@s.whatsapp.net", id: "msg-1", fromMe: false },
    messageType: "conversation",
    message: { conversation: "oi" },
    messageTimestamp: 1719619200,
    pushName: "João",
  },
};

describe("parseWebhook — tracking extraction", () => {
  it("extrai ctwaClid de referralInfo e monta fbc", () => {
    const payload = {
      ...BASE_UPSERT,
      data: {
        ...BASE_UPSERT.data,
        referralInfo: {
          ctwaClid: "AZrXXX",
          adId: "12345",
          sourceUrl: "https://fb.com/ad/123",
        },
      },
    };
    const events = parseWebhook(payload);
    expect(events).toHaveLength(1);
    expect(events[0]?.tracking).toBeDefined();
    expect(events[0]?.tracking?.ctwa_clid).toBe("AZrXXX");
    expect(events[0]?.tracking?.fbc).toMatch(/^fb\.1\.\d+\.AZrXXX$/);
    expect(events[0]?.tracking?.ad_id).toBe("12345");
    expect(events[0]?.tracking?.source_url).toBe("https://fb.com/ad/123");
  });

  it("usa contextInfo.externalAdReply como fallback", () => {
    const payload = {
      ...BASE_UPSERT,
      data: {
        ...BASE_UPSERT.data,
        contextInfo: {
          externalAdReply: { ctwaClid: "AZrYYY", adId: "99999" },
        },
      },
    };
    const events = parseWebhook(payload);
    expect(events[0]?.tracking?.ctwa_clid).toBe("AZrYYY");
    expect(events[0]?.tracking?.fbc).toMatch(/^fb\.1\.\d+\.AZrYYY$/);
  });

  it("referralInfo tem precedência sobre contextInfo", () => {
    const payload = {
      ...BASE_UPSERT,
      data: {
        ...BASE_UPSERT.data,
        referralInfo: { ctwaClid: "PRIORITY" },
        contextInfo: { externalAdReply: { ctwaClid: "FALLBACK" } },
      },
    };
    const events = parseWebhook(payload);
    expect(events[0]?.tracking?.ctwa_clid).toBe("PRIORITY");
  });

  it("retorna tracking undefined quando não há ctwaClid", () => {
    const events = parseWebhook(BASE_UPSERT);
    expect(events[0]?.tracking).toBeUndefined();
  });

  it("retorna tracking undefined quando referralInfo existe mas sem ctwaClid", () => {
    const payload = {
      ...BASE_UPSERT,
      data: { ...BASE_UPSERT.data, referralInfo: { adId: "123" } },
    };
    const events = parseWebhook(payload);
    expect(events[0]?.tracking).toBeUndefined();
  });
});
