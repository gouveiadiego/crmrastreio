import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requireOrgMember } from "@/lib/auth/guards";
import { getLeadsByOrg } from "@/lib/leads/queries";
import { getStagesByOrg } from "@/lib/leads/stages/queries";
import { LeadsKanban } from "./_components/leads-kanban";

type Props = { params: Promise<{ orgSlug: string }> };

export const metadata = { title: "Leads" };

export default async function LeadsPage({ params }: Props) {
  const { orgSlug } = await params;
  const { org } = await requireOrgMember({ orgSlug });

  const [stages, leads] = await Promise.all([
    getStagesByOrg(org.id),
    getLeadsByOrg(org.id),
  ]);

  if (stages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
        <h1 className="text-2xl font-semibold">Configure seu funil primeiro</h1>
        <p className="text-muted-foreground text-sm max-w-sm">
          Antes de ver os leads, crie as etapas do seu funil de qualificação.
        </p>
        <Button
          render={<Link href={`/app/${orgSlug}/settings/funnel`} />}
          nativeButton={false}
        >
          Configurar funil
        </Button>
      </div>
    );
  }

  return (
    <div className="-mx-6 -mb-24 -mt-6 min-h-0 flex-1 flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <h1 className="text-xl font-semibold">Leads</h1>
        <Button
          render={<Link href={`/app/${orgSlug}/settings/funnel`} />}
          nativeButton={false}
          variant="outline"
          size="sm"
        >
          Configurar funil
        </Button>
      </div>
      <LeadsKanban stages={stages} leads={leads} orgSlug={orgSlug} />
    </div>
  );
}
