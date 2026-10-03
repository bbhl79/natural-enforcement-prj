/** D3 §10 seedKey。只留键，不填种子行。 */
export const SEED_KEYS = [
  "calendar.workday",
  "hearing.amount_line",
  "hearing.non_amount",
  "major.catalog",
  "collab.hui.type_strategy",
  "gov.supervise.tags",
  "gov.review.sample_ratio",
  "exec.observe_window",
  "doc.template_meta",
  "domain.enum",
  "clue.source",
  "material.type",
  "opcode.registry",
  "copilot.hook",
] as const;

export type SeedKey = (typeof SEED_KEYS)[number];
