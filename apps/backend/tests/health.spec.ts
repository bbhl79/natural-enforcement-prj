import { describe, expect, it } from "vitest";
import { HealthController } from "../src/health.controller";

describe("HealthController", () => {
  it("不连接数据库时返回 ok", () => {
    expect(new HealthController().health()).toEqual({ status: "ok" });
  });
});
