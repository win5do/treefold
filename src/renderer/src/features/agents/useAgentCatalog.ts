import { useQuery } from "@tanstack/react-query";
import { settingsQuery, systemQuery } from "@/features/app/queries";
import { AGENT_KINDS, AGENT_NAMES } from "./model";

export function useAgentCatalog() {
  const settings = useQuery(settingsQuery());
  const system = useQuery({ ...systemQuery(), refetchOnMount: "always" });
  const order = settings.data?.agents.order ?? AGENT_KINDS;
  return {
    agents: order.map(kind => system.data?.agents.find(agent => agent.kind === kind) ?? {
      kind, name: AGENT_NAMES[kind], available: false,
    }),
    loading: settings.isPending || system.isPending,
    error: settings.error ?? system.error,
  };
}
