"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { CanvasState } from "./use-local-storage";
import { LocalSyncAdapter } from "@/lib/sync/local-sync-adapter";
import { SaveQueue } from "@/lib/sync/save-queue";
import { mergeCanvas } from "@/lib/sync/merge";
import { reconcileOnLoad } from "@/lib/sync/reconcile";
import {
  clearDirtyMeta,
  readDirtyMeta,
  writeDirtyMeta,
} from "@/lib/sync/dirty-meta";
import type { SaveStatus } from "@/lib/sync/types";
import { toast } from "@/components/shared/toaster";

/**
 * 画布服务器端持久化同步 Hook（F3 全面改造）
 *
 * 数据流：
 * - localStorage（useCanvasStorage）= 即时缓存（每次编辑同步写入）
 * - SQLite（/api/canvas-layout）= 持久保存（防抖 1.5s + 失败重试 + 页面隐藏 flush）
 *
 * 相比旧实现的修复（对应 F3-T1 审计报告）：
 * - R1 保存失败重试：SaveQueue 指数退避重试，状态暴露给 UI（saving/saved/error）
 * - R4 加载协调：本地有未同步修改（dirty meta）且晚于服务器 → 保留本地并推送
 * - X1 加载竞态：GET 返回前用户已编辑（引用比较）→ 不覆盖用户编辑
 * - X2 乐观锁：PUT 带 baseRevision，409 冲突时合并（新增保底）后重试
 * - R6 卸载兜底：visibilitychange 提前 flush（主路径）+ pagehide keepalive（兜底）
 *
 * 代码审查修复（2026-08）：
 * - S2：409 合并基底改用最新画布引用（防 PUT→409 往返期间的用户编辑丢失）
 * - G3：pagehide 仅在无在途保存时直发 keepalive（防同画布双 PUT 并发）
 * - G5：加载失败后首次保存前补一次加载（防 baseRevision=null 盲覆盖服务器）
 * - B1/B2：use-server 覆盖本地 / keepalive 保存成功后清除脏标记
 */
const SAVE_DEBOUNCE_MS = 1500;

/** 同步状态（供 UI 完整性监控展示） */
export interface CanvasSyncState {
  /** 服务器布局是否已加载完成（加载完成前不触发保存） */
  loaded: boolean;
  /** 保存状态（idle/pending/saving/saved/error） */
  status: SaveStatus;
  /** 手动重试（保存失败时用户点击） */
  retry: () => void;
}

export function useCanvasServerSync(
  canvas: CanvasState,
  setCanvas: (value: CanvasState) => void
): CanvasSyncState {
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<SaveStatus>({ phase: "idle" });

  const adapterRef = useRef<LocalSyncAdapter | null>(null);
  if (!adapterRef.current) adapterRef.current = new LocalSyncAdapter();

  /** 最新画布引用（flush 时读取，避免闭包过期） */
  const canvasRef = useRef(canvas);
  canvasRef.current = canvas;
  /** 挂载时的画布引用：用于检测"GET 返回前用户已编辑"（X1 加载竞态） */
  const mountCanvasRef = useRef(canvas);
  /**
   * 已持久化到服务器的画布引用（dirty 判定基准）：
   * canvas 引用与之不同 = 存在未保存变更
   */
  const serverCanvasRef = useRef<CanvasState | null>(null);
  /** 已知的服务器 revision（乐观锁基线） */
  const revisionRef = useRef<number | null>(null);
  const queueRef = useRef<SaveQueue | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** setCanvas 稳定引用（onConflict 回调中使用） */
  const setCanvasRef = useRef(setCanvas);
  setCanvasRef.current = setCanvas;
  /** 最新保存阶段快照（pagehide 判定"是否有在途保存"用，不参与渲染） */
  const statusRef = useRef<SaveStatus>({ phase: "idle" });
  /** 首次加载是否失败（G5：保存前需补一次加载获取乐观锁基线） */
  const loadFailedRef = useRef(false);

  /** 懒初始化保存队列（doSave 内统一维护 serverCanvas/revision/dirty meta） */
  const ensureQueue = useCallback((): SaveQueue => {
    if (queueRef.current) return queueRef.current;
    const queue = new SaveQueue(
      async (task) => {
        const result = await adapterRef.current!.save(
          task.canvas,
          task.baseRevision
        );
        if (result.outcome === "saved") {
          // 成功：该版本已持久化 → 更新 dirty 判定基准与乐观锁基线
          serverCanvasRef.current = task.canvas;
          revisionRef.current = result.revision;
          clearDirtyMeta();
        }
        return result;
      },
      {
        onStatus: (status) => {
          // 同步维护 ref（pagehide 等非 React 上下文需要读取最新阶段）
          statusRef.current = status;
          setStatus(status);
        },
        onConflict: async (result, task) => {
          // X2 修复：服务器已被其他通道（AI 批量写入）修改
          // → 以服务器为基底合并本地新增（nodes/edges/tags 按 id diff）后重试
          //
          // S2 修复（审查）：合并基底必须用"最新画布引用"而非 task.canvas——
          // task.canvas 是防抖入队时刻的快照，PUT→409 网络往返期间的用户编辑
          // 只存在于 canvasRef 中；若以 task.canvas 为基底，setCanvas(merged)
          // 会用旧快照的合并结果覆盖最新 state，往返期间的编辑被静默丢弃
          const latest = canvasRef.current ?? task.canvas;
          const merged = mergeCanvas(result.serverCanvas, latest);
          // 清除挂起的防抖计时器：其闭包捕获的是合并前的旧画布引用，
          // 若放任触发会用旧画布覆盖下方 enqueue 的合并结果（丢服务器新增）
          if (debounceRef.current) {
            clearTimeout(debounceRef.current);
            debounceRef.current = null;
          }
          revisionRef.current = result.serverRevision;
          serverCanvasRef.current = merged;
          setCanvasRef.current(merged);
          toast.info("画布已被其他程序更新（如 AI 添加卡片），已自动合并本地新增内容");
          queue.enqueue({
            canvas: merged,
            baseRevision: result.serverRevision,
          });
        },
      }
    );
    queueRef.current = queue;
    return queue;
  }, []);

  /**
   * 首次加载：新旧数据协调（R4/X1 修复）
   * 决策优先级：会话内已编辑 > 本地未同步修改（dirty meta）> 服务器优先
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let server: Awaited<ReturnType<LocalSyncAdapter["load"]>>;
      try {
        server = await adapterRef.current!.load();
      } catch (err) {
        // 加载失败：保留 localStorage 缓存兜底（不覆盖、不阻塞）
        console.warn("[canvas-sync] 加载服务器布局失败:", err);
        if (!cancelled) {
          setLoaded(true);
          // G5 修复（审查）：标记加载失败——revision 基线缺失时，后续保存会
          // 以 baseRevision=null 无条件覆盖服务器；首次保存前需补一次加载
          loadFailedRef.current = true;
        }
        return;
      }
      if (cancelled) return;

      const decision = reconcileOnLoad({
        hasLocalCanvas:
          (canvasRef.current?.nodes?.length ?? 0) > 0 ||
          (canvasRef.current?.edges?.length ?? 0) > 0,
        dirtySavedAt: readDirtyMeta(),
        serverUpdatedAt: server.updatedAt,
        // 引用比较：GET 期间 canvas 已被用户编辑 → 引用不同于挂载时
        sessionEdited: canvasRef.current !== mountCanvasRef.current,
      });

      if (decision.action === "use-server") {
        if (server.canvas) {
          serverCanvasRef.current = server.canvas;
          revisionRef.current = server.revision;
          setCanvasRef.current(server.canvas);
          // B1 修复（审查）：本地已被服务器版本取代，同步清除脏标记——
          // 残留标记会让下次会话 reconcile 误判"本地有未同步修改"而保留旧缓存
          clearDirtyMeta();
        } else if (
          canvasRef.current?.nodes?.length ||
          canvasRef.current?.edges?.length
        ) {
          // 服务器无数据而本地缓存有：推送本地到服务器（建立服务器副本）
          ensureQueue().enqueue({
            canvas: canvasRef.current,
            baseRevision: null,
          });
        }
      } else {
        // keep-local / keep-local-edited：保留本地并立即推送服务器
        revisionRef.current = server.revision;
        ensureQueue().enqueue({
          canvas: canvasRef.current,
          baseRevision: server.revision,
        });
        if (decision.action === "keep-local") {
          console.warn(
            "[canvas-sync] 检测到上次会话未同步的本地修改，已保留本地版本并推送服务器"
          );
        }
      }
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
    // 仅挂载时执行一次（依赖的 refs 自行保持最新）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 防抖保存（loaded 后）：
   * canvas 引用 ≠ 已持久化引用（serverCanvasRef）= 存在未保存变更
   * → 写 dirty meta + 防抖入队
   */
  useEffect(() => {
    if (!loaded) return;
    // 引用相同：无实际变更（服务器应用的数据 / 刚保存确认的版本）
    if (canvas === serverCanvasRef.current) return;

    // 标记未同步修改（供下次会话协调，R4 修复）
    writeDirtyMeta(Date.now());

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void (async () => {
        // G5 修复（审查）：首次加载失败时 revision 基线缺失（null = 无条件
        // 覆盖服务器）。首次保存前补一次加载获取基线；仍失败才降级为
        // 无条件写入（此时服务器大概率确实不可用，localStorage 兜底）。
        if (loadFailedRef.current) {
          try {
            const server = await adapterRef.current!.load();
            loadFailedRef.current = false;
            // 仅取 revision 作乐观锁基线：本地画布照常推送，若基线不符
            // 服务器会返回 409，由 onConflict 合并（等价"本地胜"语义）
            revisionRef.current = server.revision;
          } catch {
            /* 仍失败：保持 null，降级无条件写入 */
          }
        }
        ensureQueue().enqueue({
          canvas,
          baseRevision: revisionRef.current,
        });
      })();
    }, SAVE_DEBOUNCE_MS);
  }, [canvas, loaded, ensureQueue]);

  /**
   * 页面隐藏时立即 flush（R6 主路径：页面仍存活，普通 fetch 可靠）
   * - visibilitychange → hidden（切标签页/最小化）：走队列正常落盘（可重试）
   * - pagehide（真正卸载）：keepalive fetch 兜底（受 64KB body 限制）
   */
  useEffect(() => {
    const onVisibilityHide = () => {
      if (document.visibilityState !== "hidden") return;
      // 防抖未到期：立即入队并冲刷
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
        ensureQueue().enqueue({
          canvas: canvasRef.current,
          baseRevision: revisionRef.current,
        });
      }
      queueRef.current?.flush();
    };
    const onPageHide = () => {
      // 卸载兜底：keepalive 请求即使页面关闭也可由浏览器完成
      // （冲突/失败不再处理，下次加载由 reconcile/merge 兜底）
      //
      // G3 修复（审查）：仅在"防抖未到期且无在途保存"时直发——
      // 在途保存（saving）携带的是已入队数据，再直发同一画布会产生
      // 两个并发 PUT：其一必然 409 且无人处理，叠加服务端竞态放大风险。
      // 在途场景信任已发出的请求 + dirty meta 兜底（下次会话 reconcile）。
      if (debounceRef.current && statusRef.current.phase !== "saving") {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
        adapterRef
          .current!.save(canvasRef.current, revisionRef.current, {
            keepalive: true,
          })
          .then((result) => {
            // B2 修复（审查）：keepalive 保存成功后清除脏标记——
            // 否则下次会话 reconcile 会误判"本地有未同步修改"而覆盖服务器新数据
            if (result.outcome === "saved") clearDirtyMeta();
          })
          .catch(() => {
            /* 卸载时静默失败，localStorage + dirty meta 兜底 */
          });
      }
    };
    document.addEventListener("visibilitychange", onVisibilityHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityHide);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [ensureQueue]);

  /** 卸载清理：停掉队列（防抖 timer 由 React cleanup 隐式跳过：闭包过期不再入队） */
  useEffect(() => {
    return () => {
      queueRef.current?.dispose();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  /** 手动重试（保存失败时 UI 提供"重试"按钮） */
  const retry = useCallback(() => {
    queueRef.current?.retryNow();
  }, []);

  return { loaded, status, retry };
}
