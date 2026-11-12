// 用途：按法规出处纪律校验应然模型节点，输出 ok 与待权威两类结果。
// 发现器出处纪律校验（spec #322 Q13 / 二期 T7，seam⑥）：应然节点 → ok | 待权威。
// 纯函数，无 I/O：不读写文件、不建 issue。待权威节点只产决策票草案数据，
// 由人/上层流程按 docs/agents/issue-tracker.md 开票；未批准前不进实现方向与对账缺口。

/**
 * 一条法规出处：法规标识 + 条款号（spec #322 Q13「法规名 + 条款号」）。
 * 法规标识 = 文件表编号（ADR 0019）或法规名，至少填一个；
 * 与 `.github/ISSUE_TEMPLATE/feedback.md` 的「法规名 + 条款号」字段口径一致。
 */
export interface LegalCitation {
  /** 文件表编号（如 doc_002）；与 documentName 至少填一个。 */
  readonly documentCode?: string;
  /** 法规名（人读副本）；与 documentCode 至少填一个。 */
  readonly documentName?: string;
  /** 条款号（如 2.5、第 6 条、3.2.3.1(11)）。 */
  readonly articleNo: string;
}

/** 应然模型草案的一个节点。字段可缺省：缺省即待权威，由本校验拦下。 */
export interface AssertedNode {
  readonly nodeId: string;
  readonly legalBasis?: readonly LegalCitation[];
  readonly roleBasis?: readonly string[];
}

/** 校验判定：出处齐备或待权威。 */
export type SourceVerdict = 'ok' | 'pending-authority';

/** 决策票草案：只产数据，不开票。 */
export interface DecisionTicketDraft {
  readonly title: string;
  readonly labels: readonly string[];
  readonly body: string;
}

/** 单个节点的校验结果；待权威项挂决策票草案，ok 项恒为 null。 */
export interface SourceCheckResult {
  readonly nodeId: string;
  readonly verdict: SourceVerdict;
  readonly reason: string;
  readonly decisionTicket: DecisionTicketDraft | null;
}

/** 空白判定：缺省与纯空白串同等视为未填。 */
function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === '';
}

/** 法规出处缺失项：整体缺，或某条缺法规标识/条款号。 */
function citationGaps(citations: readonly LegalCitation[] | undefined): string[] {
  if (citations === undefined || citations.length === 0) return ['法规出处'];
  const gaps: string[] = [];
  citations.forEach((citation, index) => {
    const missing: string[] = [];
    if (isBlank(citation.documentCode) && isBlank(citation.documentName)) {
      missing.push('法规标识（文件编号或法规名）');
    }
    if (isBlank(citation.articleNo)) missing.push('条款号');
    if (missing.length > 0) {
      gaps.push(`法规出处第 ${index + 1} 条缺${missing.join('、')}`);
    }
  });
  return gaps;
}

/** 角色依据缺失项：整体缺，或某项为空白。 */
function roleGaps(roleBasis: readonly string[] | undefined): string[] {
  if (roleBasis === undefined || roleBasis.length === 0) return ['角色依据'];
  const gaps: string[] = [];
  roleBasis.forEach((role, index) => {
    if (isBlank(role)) gaps.push(`角色依据第 ${index + 1} 项为空`);
  });
  return gaps;
}

/** 待权威节点的决策票草案。 */
function decisionTicketOf(nodeId: string, gaps: readonly string[]): DecisionTicketDraft {
  return {
    title: `[决策] 应然节点 ${nodeId} 出处待权威`,
    labels: ['needs-triage'],
    body: [
      `应然节点 ${nodeId} 的法规出处或角色依据不齐备，按 spec #322 Q13 标待权威。`,
      '',
      `缺失项：${gaps.join('；')}`,
      '',
      '处理方式：只立决策票请主管钉死出处。未批准前该节点不进实现方向，也不计入对账缺口。',
    ].join('\n'),
  };
}

/** 逐节点校验出处纪律：一个节点一条结果，顺序与输入一致。 */
export function checkNodeSources(nodes: readonly AssertedNode[]): SourceCheckResult[] {
  return nodes.map((node): SourceCheckResult => {
    const gaps = [...citationGaps(node.legalBasis), ...roleGaps(node.roleBasis)];
    if (gaps.length === 0) {
      return {
        nodeId: node.nodeId,
        verdict: 'ok',
        reason: `出处齐备：法规出处 ${node.legalBasis?.length ?? 0} 条、角色依据 ${node.roleBasis?.length ?? 0} 项`,
        decisionTicket: null,
      };
    }
    return {
      nodeId: node.nodeId,
      verdict: 'pending-authority',
      reason: `待权威：${gaps.join('；')}。未批准前只产决策票，不进实现方向与对账缺口。`,
      decisionTicket: decisionTicketOf(node.nodeId, gaps),
    };
  });
}

/** 实现方向准入：只放行出处齐备节点；待权威节点由决策票另行裁决。 */
export function admittedNodeIds(results: readonly SourceCheckResult[]): string[] {
  return results.filter((result) => result.verdict === 'ok').map((result) => result.nodeId);
}
