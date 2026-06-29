import { notFound } from "next/navigation";
import { verifyQrToken } from "@/lib/messaging/adapters/whatsapp-evolution/qr-token";
import { QrScanner } from "./qr-scanner";

export const metadata = { title: "Conectar WhatsApp" };

export default async function QrConnectPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const payload = verifyQrToken(token);
  if (!payload) notFound();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6">
      <QrScanner token={token} />
    </div>
  );
}
