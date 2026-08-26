/**
 * 插件执行期权限校验测试（F5-T7）
 *
 * 覆盖纯函数层：
 *   - isScopeSubset：子集判断
 *   - requiredScopesFor：端点映射查询（大小写/未登记端点）
 */
import { describe, expect, it } from "vitest";
import { isScopeSubset } from "@/lib/plugins/permissions";
import {
  ENDPOINT_SCOPES,
  requiredScopesFor,
} from "@/lib/plugins/scopes";

describe("isScopeSubset — 权限子集判断", () => {
  it("空必需集恒为子集", () => {
    expect(isScopeSubset([], [])).toBe(true);
    expect(isScopeSubset([], ["cards:read"])).toBe(true);
  });

  it("完全包含 → 通过", () => {
    expect(isScopeSubset(["cards:read"], ["cards:read"])).toBe(true);
    expect(
      isScopeSubset(
        ["cards:write", "canvas:write"],
        ["cards:read", "cards:write", "canvas:read", "canvas:write"]
      )
    ).toBe(true);
  });

  it("缺失任一作用域 → 拒绝", () => {
    expect(isScopeSubset(["cards:write"], ["cards:read"])).toBe(false);
    expect(
      isScopeSubset(
        ["cards:write", "canvas:write"],
        ["cards:write", "canvas:read"]
      )
    ).toBe(false);
  });

  it("granted 含重复项不影响判断", () => {
    expect(
      isScopeSubset(["cards:read"], ["cards:read", "cards:read"])
    ).toBe(true);
  });
});

describe("requiredScopesFor — 端点权限映射", () => {
  it("batch 端点需要 cards:write + canvas:write", () => {
    expect(requiredScopesFor("POST", "/api/cards/batch")).toEqual([
      "cards:write",
      "canvas:write",
    ]);
  });

  it("方法大小写不敏感（规范化为大写）", () => {
    expect(requiredScopesFor("post", "/api/cards/batch")).toEqual(
      requiredScopesFor("POST", "/api/cards/batch")
    );
  });

  it("画布读取需要 canvas:read", () => {
    expect(requiredScopesFor("GET", "/api/canvas-layout")).toEqual([
      "canvas:read",
    ]);
  });

  it("未登记端点返回 null（无插件级权限要求）", () => {
    expect(requiredScopesFor("GET", "/api/health")).toBeNull();
    expect(requiredScopesFor("DELETE", "/api/cards/batch")).toBeNull();
  });

  it("映射表覆盖全部画布工具端点", () => {
    // 登记表是执行期权限的权威来源：内置插件声明的端点必须全部登记
    const registered = Object.keys(ENDPOINT_SCOPES);
    expect(registered).toContain("GET /api/cards");
    expect(registered).toContain("POST /api/cards/connect");
    expect(registered).toContain("PUT /api/canvas-layout");
  });
});
