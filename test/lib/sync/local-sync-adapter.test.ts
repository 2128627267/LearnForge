/**
 * LocalSyncAdapter 测试（F3-T6）
 *
 * mock 全局 fetch，验证 REST 协议映射：
 * - load：GET 成功/HTTP 错误
 * - save：PUT 成功（revision 解析）/ 409 冲突 / 5xx 可重试 / 4xx 不可重试 / 网络异常
 * - keepalive 选项透传
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LocalSyncAdapter } from "@/lib/sync/local-sync-adapter";
import type { CanvasState } from "@/lib/hooks/use-local-storage";

const emptyCanvas: CanvasState = { nodes: [], edges: [], tags: [] };

/** 构造 JSON Response */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("LocalSyncAdapter", () => {
  let adapter: LocalSyncAdapter;
  const fetchMock = vi.fn();

  beforeEach(() => {
    adapter = new LocalSyncAdapter();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("load", () => {
    it("成功时应返回画布与 revision", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          data: emptyCanvas,
          revision: 7,
          updatedAt: "2026-08-26T00:00:00Z",
        })
      );
      const result = await adapter.load();
      expect(result.canvas).toEqual(emptyCanvas);
      expect(result.revision).toBe(7);
      expect(result.updatedAt).toBe("2026-08-26T00:00:00Z");
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/canvas-layout",
        expect.objectContaining({ cache: "no-store" })
      );
    });

    it("服务器无数据时应返回 null", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ data: null, revision: null, updatedAt: null })
      );
      const result = await adapter.load();
      expect(result.canvas).toBeNull();
      expect(result.revision).toBeNull();
    });

    it("HTTP 错误时应抛出异常", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ error: "x" }, 500));
      await expect(adapter.load()).rejects.toThrow("HTTP 500");
    });

    it("响应缺省字段时应回退 null", async () => {
      fetchMock.mockResolvedValue(jsonResponse({}));
      const result = await adapter.load();
      expect(result).toEqual({
        canvas: null,
        revision: null,
        updatedAt: null,
      });
    });
  });

  describe("save", () => {
    it("成功时应返回 saved 与新 revision", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, revision: 8 }));
      const result = await adapter.save(emptyCanvas, 7);
      expect(result).toEqual({ outcome: "saved", revision: 8 });
      // 请求体协议：{ canvas, baseRevision }
      const [, init] = fetchMock.mock.calls[0];
      expect(init.method).toBe("PUT");
      expect(JSON.parse(init.body)).toEqual({
        canvas: emptyCanvas,
        baseRevision: 7,
      });
    });

    it("409 时应返回 conflict 携带服务器数据", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(
          { error: "revision_conflict", revision: 9, data: emptyCanvas },
          409
        )
      );
      const result = await adapter.save(emptyCanvas, 7);
      expect(result).toEqual({
        outcome: "conflict",
        serverCanvas: emptyCanvas,
        serverRevision: 9,
      });
    });

    it("5xx 时应返回可重试失败", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ error: "x" }, 503));
      const result = await adapter.save(emptyCanvas, 7);
      expect(result).toEqual({
        outcome: "failed",
        retryable: true,
        status: 503,
      });
    });

    it("4xx 时应返回不可重试失败", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ error: "x" }, 400));
      const result = await adapter.save(emptyCanvas, 7);
      expect(result).toEqual({
        outcome: "failed",
        retryable: false,
        status: 400,
      });
    });

    it("网络异常（fetch reject）时应返回可重试失败而非抛出", async () => {
      fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
      const result = await adapter.save(emptyCanvas, 7);
      expect(result).toEqual({ outcome: "failed", retryable: true });
    });

    it("keepalive 选项应透传给 fetch", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, revision: 2 }));
      await adapter.save(emptyCanvas, null, { keepalive: true });
      const [, init] = fetchMock.mock.calls[0];
      expect(init.keepalive).toBe(true);
    });

    it("默认不启用 keepalive（避免 64KB body 限制影响正常保存）", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, revision: 2 }));
      await adapter.save(emptyCanvas, null);
      const [, init] = fetchMock.mock.calls[0];
      expect(init.keepalive).toBe(false);
    });
  });

  describe("快照与日志", () => {
    it("listSnapshots 应请求列表并解析数据", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ data: [] }));
      await adapter.listSnapshots(15);
      expect(fetchMock.mock.calls[0][0]).toBe("/api/canvas-snapshots?limit=15");
    });

    it("listSnapshots HTTP 错误时应抛出异常", async () => {
      fetchMock.mockResolvedValue(jsonResponse({}, 500));
      await expect(adapter.listSnapshots()).rejects.toThrow("HTTP 500");
    });

    it("createSnapshot 应 POST manual 快照", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ id: "snap1", nodeCount: 3, edgeCount: 1, reason: "manual", createdAt: "2026-08-26T00:00:00Z" })
      );
      const snap = await adapter.createSnapshot("manual");
      expect(snap.id).toBe("snap1");
      const [, init] = fetchMock.mock.calls[0];
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body)).toEqual({ reason: "manual" });
    });

    it("restoreSnapshot 应 POST 恢复端点并返回画布", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ canvas: emptyCanvas, revision: 10 })
      );
      const result = await adapter.restoreSnapshot("snap1");
      expect(result).toEqual({ canvas: emptyCanvas, revision: 10 });
      expect(fetchMock.mock.calls[0][0]).toBe(
        "/api/canvas-snapshots/snap1/restore"
      );
      expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    });

    it("listChangeLog 应请求日志并解析数据", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ data: [] }));
      await adapter.listChangeLog(30);
      expect(fetchMock.mock.calls[0][0]).toBe("/api/canvas-changelog?limit=30");
    });
  });
});
