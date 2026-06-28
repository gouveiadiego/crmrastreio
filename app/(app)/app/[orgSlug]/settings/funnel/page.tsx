import { requireOrgRole } from "@/lib/auth/guards";
import { getStagesByOrg } from "@/lib/leads/stages/queries";
import { StagesList } from "./_components/stages-list";

type Props = { params: Promise<{ orgSlug: string }> };

export const metadata = { title: "Funil de Leads" };

export default async function FunnelSettingsPage({ params }: Props) {
  const { orgSlug } = await params;
  const { org } = await requireOrgRole({ orgSlug, roles: ["owner", "admin"] });
  const stages = await getStagesByOrg(org.id);

  return (
    <div className="space-y-8">
      <div className="space-y-1.5">
        <span className="label-mono">/ funil</span>
        <h1 className="font-semibold text-3xl tracking-tight">Funil de Leads</h1>
        <p className="text-muted-foreground text-sm">
          Configure as etapas do kanban e mapeie cada uma para um evento do Meta Ads.
        </p>
      </div>
      <div className="max-w-2xl">
        <StagesList stages={stages} orgSlug={orgSlug} />
      </div>
    </div>
  );
}
