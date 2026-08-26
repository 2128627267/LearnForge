/**
 * 插件 manifest 校验测试（F5-T7）
 *
 * 覆盖：
 *   - 合法 manifest 通过解析 + 默认值填充
 *   - 命名/版本/结构非法拒绝
 *   - 语义校验：工具权限超集 / 工具名重复 / 端点外站路径
 *   - 内置插件清单自检（合法 + 工具与端点映射一致）
 */
import { describe, expect, it } from "vitest";
import { PluginManifestSchema, parseManifest } from "@/lib/plugins/manifest";
import { BUILTIN_CANVAS_MANIFEST } from "@/lib/plugins/builtin";
import { ENDPOINT_SCOPES } from "@/lib/plugins/scopes";

/** 最小合法 manifest 模板（每个用例按需覆写字段） */
function validManifest() {
  return {
    name: "demo-pack",
    displayName: "演示插件",
    version: "1.0.0",
    permissions: ["cards:read", "cards:write"],
    tools: [
      {
        name: "demo_tool",
        description: "演示工具",
        parameters: {
          type: "object",
          properties: { q: { type: "string" } },
          required: ["q"],
        },
        endpoint: { method: "GET", url: "/api/cards" },
        permissions: ["cards:read"],
      },
    ],
  };
}

describe("PluginManifestSchema — 结构校验", () => {
  it("合法 manifest 通过并填充默认值", () => {
    const parsed = parseManifest(validManifest());
    expect(parsed.name).toBe("demo-pack");
    expect(parsed.description).toBe(""); // 可选字段默认值
    expect(parsed.author).toBe("");
    expect(parsed.tools[0].parameters).toBeDefined();
  });

  it("插件名必须 kebab-case（拒绝大写/下划线/数字开头）", () => {
    for (const bad of ["Demo-Pack", "demo_pack", "1demo", "demo-", ""]) {
      const result = PluginManifestSchema.safeParse({
        ...validManifest(),
        name: bad,
      });
      expect(result.success).toBe(false);
    }
  });

  it("工具名必须 snake_case（拒绝连字符/大写）", () => {
    const result = PluginManifestSchema.safeParse({
      ...validManifest(),
      tools: [
        {
          ...validManifest().tools[0],
          name: "demo-tool",
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("版本必须 semver X.Y.Z", () => {
    for (const bad of ["1.0", "v1.0.0", "1.0.0.0", "latest"]) {
      const result = PluginManifestSchema.safeParse({
        ...validManifest(),
        version: bad,
      });
      expect(result.success).toBe(false);
    }
  });

  it("未知权限作用域拒绝", () => {
    const result = PluginManifestSchema.safeParse({
      ...validManifest(),
      permissions: ["cards:read", "admin:all"],
    });
    expect(result.success).toBe(false);
  });

  it("端点必须 /api/ 开头（拒绝外站 URL）", () => {
    const result = PluginManifestSchema.safeParse({
      ...validManifest(),
      tools: [
        {
          ...validManifest().tools[0],
          endpoint: { method: "GET", url: "https://evil.example.com/api" },
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("空工具列表拒绝（至少 1 个）", () => {
    const result = PluginManifestSchema.safeParse({
      ...validManifest(),
      tools: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("PluginManifestSchema — 语义校验", () => {
  it("工具所需权限超出插件声明总集时拒绝", () => {
    const result = PluginManifestSchema.safeParse({
      ...validManifest(),
      // 插件只声明 cards:read，工具却要 cards:write
      permissions: ["cards:read"],
      tools: [
        {
          ...validManifest().tools[0],
          permissions: ["cards:write"],
        },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      // 错误信息可读（含工具名与缺失权限）
      const msg = result.error.issues.map((i) => i.message).join(";");
      expect(msg).toContain("demo_tool");
      expect(msg).toContain("cards:write");
    }
  });

  it("插件内工具名重复拒绝", () => {
    const tool = validManifest().tools[0];
    const result = PluginManifestSchema.safeParse({
      ...validManifest(),
      tools: [tool, { ...tool }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = result.error.issues.map((i) => i.message).join(";");
      expect(msg).toContain("重复");
    }
  });

  it("工具权限为插件总集子集时通过（多作用域）", () => {
    const parsed = parseManifest({
      ...validManifest(),
      permissions: ["cards:read", "cards:write", "canvas:read", "canvas:write"],
      tools: [
        validManifest().tools[0],
        {
          ...validManifest().tools[0],
          name: "demo_write_tool",
          endpoint: { method: "POST", url: "/api/cards/batch" },
          permissions: ["cards:write", "canvas:write"],
        },
      ],
    });
    expect(parsed.tools).toHaveLength(2);
  });
});

describe("内置插件清单自检", () => {
  it("BUILTIN_CANVAS_MANIFEST 通过 schema 校验", () => {
    // 保证内置清单升级时不会引入结构性错误（ensureBuiltinPlugins 直接写库）
    const parsed = parseManifest(BUILTIN_CANVAS_MANIFEST);
    expect(parsed.name).toBe("builtin-canvas");
    expect(parsed.tools).toHaveLength(4);
  });

  it("内置 4 工具与原 capabilities 硬编码一致", () => {
    const names = BUILTIN_CANVAS_MANIFEST.tools.map((t) => t.name);
    expect(names).toEqual([
      "create_cards_batch",
      "connect_cards",
      "get_canvas",
      "list_cards",
    ]);
  });

  it("内置工具端点均在服务端权限映射表中登记", () => {
    // 防止内置插件声明了未登记端点（导致插件身份调用绕过/拒绝异常）
    for (const tool of BUILTIN_CANVAS_MANIFEST.tools) {
      const key = `${tool.endpoint.method} ${tool.endpoint.url}`;
      expect(ENDPOINT_SCOPES[key]).toBeDefined();
    }
  });
});
