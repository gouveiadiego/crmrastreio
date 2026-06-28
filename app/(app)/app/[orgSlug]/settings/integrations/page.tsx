import { requireOrgRole } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/service";
import { MetaIntegrationForm } from "./_components/meta-integration-form";

export const metadata = { title: "Integrações" };

type Props = { params: Promise<{ orgSlug: string }> };

export default async function IntegrationsPage({ params }: Props) {
  const { orgSlug } = await params;
  const { org } = await requireOrgRole({ orgSlug, roles: ["owner", "admin"] });

  // Service client: lê pixel_id sem expor capi_token ao browser
  const supabase = createServiceClient();
  const { data: integration } = await supabase
    .from("meta_integrations")
    .select("pixel_id")
    .eq("organization_id", org.id)
    .maybeSingle();

  // hasToken: se a linha existe, capi_token existe (coluna NOT NULL)
  const hasToken = integration !== null;

  return (
    <div className="space-y-8">
      <div className="space-y-1.5">
        <span className="label-mono">/ configurações / integrações</span>
        <h1 className="font-semibold text-3xl tracking-tight">Integrações</h1>
        <p className="text-muted-foreground text-sm">
          Configure a integração com o Meta Ads para enviar eventos de conversão.
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-medium">Meta Conversions API</h2>
          <p className="text-sm text-muted-foreground">
            Quando um lead mudar de etapa no kanban, um evento é enviado direto ao Meta para
            otimizar suas campanhas. O token nunca é exibido após salvo.
          </p>
        </div>

        <MetaIntegrationForm
          orgSlug={orgSlug}
          initialPixelId={integration?.pixel_id}
          hasToken={hasToken}
        />
      </div>
    </div>
  );
}
