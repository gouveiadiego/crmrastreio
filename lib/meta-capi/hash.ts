import { createHash } from "node:crypto";

/**
 * Normaliza e hasheia telefone conforme especificação Meta Advanced Matching.
 * Meta exige: dígitos apenas, sem espaços, com DDI, lowercase, SHA-256 hex.
 * Ex: "+55 11 9 8888-7777" → hash de "5511988887777"
 */
export function hashPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8) return null;
  return createHash("sha256").update(digits).digest("hex");
}

/**
 * Hasheia string genérica (nome, email) conforme spec Meta.
 * Lowercase, trim, SHA-256 hex.
 */
export function hashField(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  return createHash("sha256").update(normalized).digest("hex");
}
