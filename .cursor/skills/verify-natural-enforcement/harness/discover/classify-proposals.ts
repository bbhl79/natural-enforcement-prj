// 已知 planned 与有意 latent 的分类。不删除提案，只移出可执行清单。
import type { DiscoverProposal } from './reconcile.ts';
import { canonicalRoute } from './reconcile.ts';

export interface ClassifiedProposals {
  readonly actionable: DiscoverProposal[];
  readonly planned: DiscoverProposal[];
  readonly intentionalLatent: DiscoverProposal[];
}

function routeOf(proposal: DiscoverProposal): string | null {
  if (proposal.route === undefined || proposal.route === '') return null;
  return canonicalRoute(proposal.route);
}

/**
 * planned 路径上的 map-drift 归 planned。
 * 被 latent scenario 引用、且无 runnable 引用的 latent-stub 归 intentional-latent。
 * 两类都保留在报告里，不当作零缺口。
 */
export function classifyProposals(
  proposals: readonly DiscoverProposal[],
  input: {
    readonly plannedPaths: readonly string[];
    readonly latentNodeIds: readonly string[];
  },
): ClassifiedProposals {
  const planned = new Set(input.plannedPaths.map((item) => canonicalRoute(item)));
  const latentNodes = new Set(input.latentNodeIds);
  const actionable: DiscoverProposal[] = [];
  const plannedOut: DiscoverProposal[] = [];
  const latentOut: DiscoverProposal[] = [];
  for (const proposal of proposals) {
    const route = routeOf(proposal);
    if (proposal.kind === 'map-drift' && route !== null && planned.has(route)) {
      plannedOut.push(proposal);
      continue;
    }
    if (
      proposal.kind === 'latent-stub' &&
      proposal.featureMapRef !== undefined &&
      latentNodes.has(proposal.featureMapRef)
    ) {
      latentOut.push(proposal);
      continue;
    }
    actionable.push(proposal);
  }
  return { actionable, planned: plannedOut, intentionalLatent: latentOut };
}
