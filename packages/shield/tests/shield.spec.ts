import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AUDIT_EVENT_TYPES,
  CASE_WRITE_OPCODES,
  COPILOT,
  HOOKS,
  MATERIAL_TYPES,
  OPCODES,
  SEED_KEYS,
  TEMPLATE_IDS,
  TEMPLATE_ISOLATION_GROUPS,
  WRITE_OPCODES,
  assertHookLevelChange,
  assertNoCopilotDecideExport,
  assertTemplateIsolation,
} from "../src/index";

describe("shield 导出面", () => {
  it("含 opcodes、hooks、materialType、templateId、seeds、audit、DTO 符号", () => {
    expect(OPCODES.investDecide).toBe("invest.decide");
    expect(WRITE_OPCODES.length).toBeGreaterThan(0);
    expect(CASE_WRITE_OPCODES).toContain("invest.decide");
    expect(HOOKS["gate.serve.receipt"]).toBe("block");
    expect(MATERIAL_TYPES).toContain("CASE_EVIDENCE");
    expect(TEMPLATE_IDS).toContain("invest.decision");
    expect(SEED_KEYS).toContain("calendar.workday");
    expect(AUDIT_EVENT_TYPES).toContain("invest.decide");
    const dto = readFileSync(new URL("../src/dto/index.ts", import.meta.url), "utf8");
    for (const name of ["Clue", "Case", "Party", "Site", "DossierIngest", "AuditEvent", "GisSkip"]) {
      expect(dto).toContain(name);
    }
  });
});

describe("block 不可降档", () => {
  it("拒绝 block 改为 warn、hint 或关闭", () => {
    expect(() => assertHookLevelChange("block", "warn")).toThrow(/不可降档/);
    expect(() => assertHookLevelChange("block", "hint")).toThrow(/不可降档/);
    expect(() => assertHookLevelChange("block", "off")).toThrow(/不可降档/);
    expect(() => assertHookLevelChange("warn", "hint")).not.toThrow();
  });
});

describe("分模板隔离", () => {
  it("告知≠听证告知、两类移送、意见书≠决定书、决定≠不予处罚", () => {
    expect(TEMPLATE_ISOLATION_GROUPS).toEqual([
      ["invest.notice", "invest.hearing_notice"],
      ["collab.xfer_police", "collab.xfer_discipline"],
      ["gov.supervision_opinion", "invest.decision"],
      ["invest.decision", "invest.no_penalty"],
    ]);
    expect(() => assertTemplateIsolation("invest.notice", "invest.hearing_notice")).toThrow(/混用/);
    expect(() => assertTemplateIsolation("collab.xfer_police", "collab.xfer_discipline")).toThrow(/混用/);
    expect(() => assertTemplateIsolation("gov.supervision_opinion", "invest.decision")).toThrow(/混用/);
    expect(() => assertTemplateIsolation("invest.decision", "invest.no_penalty")).toThrow(/混用/);
  });
});

describe("副驾驶无定案出口", () => {
  it("copilot 命名空间没有定案符号", () => {
    expect(Object.keys(COPILOT)).not.toContain("decide");
    expect(() => assertNoCopilotDecideExport(Object.keys(COPILOT))).not.toThrow();
    expect(() => assertNoCopilotDecideExport(["decide"])).toThrow(/定案/);
  });
});
