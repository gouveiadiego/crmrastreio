import { describe, expect, test } from "vitest";
import {
  bucketCountsByDay,
  computeCapiHealth,
  computeFunnelConversion,
  computePercentChange,
  sumSaleValues,
} from "@/lib/dashboard/aggregations";

describe("bucketCountsByDay", () => {
  test("conta timestamps por dia dentro do intervalo", () => {
    const result = bucketCountsByDay(
      ["2026-06-01T10:00:00Z", "2026-06-01T15:00:00Z", "2026-06-02T08:00:00Z"],
      { from: new Date("2026-06-01T00:00:00Z"), to: new Date("2026-06-03T00:00:00Z") },
    );
    expect(result).toEqual([
      { date: "2026-06-01", count: 2 },
      { date: "2026-06-02", count: 1 },
      { date: "2026-06-03", count: 0 },
    ]);
  });

  test("retorna zero em dias sem nenhum timestamp", () => {
    const result = bucketCountsByDay([], {
      from: new Date("2026-06-01T00:00:00Z"),
      to: new Date("2026-06-02T00:00:00Z"),
    });
    expect(result).toEqual([
      { date: "2026-06-01", count: 0 },
      { date: "2026-06-02", count: 0 },
    ]);
  });
});

describe("computePercentChange", () => {
  test("calcula variação percentual normal", () => {
    expect(computePercentChange(120, 100)).toBe(20);
    expect(computePercentChange(80, 100)).toBe(-20);
  });

  test("retorna 100% quando período anterior era zero e agora tem valor", () => {
    expect(computePercentChange(10, 0)).toBe(100);
  });

  test("retorna null quando os dois períodos são zero", () => {
    expect(computePercentChange(0, 0)).toBeNull();
  });
});

describe("computeFunnelConversion", () => {
  test("primeira etapa não tem conversionPct (null)", () => {
    const result = computeFunnelConversion(
      [
        { id: "s1", name: "Novo", position: 0 },
        { id: "s2", name: "Qualificado", position: 1 },
      ],
      { s1: 100, s2: 40 },
    );
    expect(result[0]).toMatchObject({ stageId: "s1", count: 100, conversionPct: null });
    expect(result[1]).toMatchObject({ stageId: "s2", count: 40, conversionPct: 40 });
  });

  test("ordena etapas por position independente da ordem de entrada", () => {
    const result = computeFunnelConversion(
      [
        { id: "s2", name: "Qualificado", position: 1 },
        { id: "s1", name: "Novo", position: 0 },
      ],
      { s1: 50, s2: 25 },
    );
    expect(result.map((r) => r.stageId)).toEqual(["s1", "s2"]);
  });

  test("etapa sem nenhuma transição no período conta como zero", () => {
    const result = computeFunnelConversion(
      [
        { id: "s1", name: "Novo", position: 0 },
        { id: "s2", name: "Qualificado", position: 1 },
      ],
      {},
    );
    expect(result[1]).toMatchObject({ count: 0, conversionPct: null });
  });
});

describe("sumSaleValues", () => {
  test("soma valores ignorando nulos", () => {
    expect(sumSaleValues([100, null, 50.5, null])).toBe(150.5);
  });

  test("retorna zero para lista vazia", () => {
    expect(sumSaleValues([])).toBe(0);
  });
});

describe("computeCapiHealth", () => {
  test("separa sucesso e erro", () => {
    expect(computeCapiHealth([null, "HTTP 400", null, null])).toEqual({ success: 3, error: 1 });
  });

  test("retorna zero/zero para lista vazia", () => {
    expect(computeCapiHealth([])).toEqual({ success: 0, error: 0 });
  });
});
