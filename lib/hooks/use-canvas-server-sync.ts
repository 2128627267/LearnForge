"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { CanvasState } from "./use-local-storage";

/**
 * 画布服务器端持久化同步 Hook
 *
 * 数据流：
 * - localStorage（useCanvasStorage）= 即时缓存（防抖 400ms）
 * - SQLite（/api/canvas-layout）= 持久保存（防抖 1.5s + 页面隐藏时立即 flush）
 *
 * 策略：
 * - 首次加载以服务器数据为准（服务器是最新保存，localStorage 仅缓存）
 * - 保存失败静默降级（console.warn），localStorage 仍兜底
 */
const LAYOUT_URL = "/api/canvas-layout";
const SAVE_DEBOUNCE_MS = 1500;

export function useCanvasServerSync(
  canvas: CanvasState,
  setCanvas: (value: CanvasState) => void
): boolean {
  /** 服务器布局是否已加载完成（加载完成前不触发保存） */
  const [loaded, setLoaded] = useState(false);
  const isFirstRender = useRef(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canvasRef = useRef(canvas);
  canvasRef.current = canvas;

  // 首次加载：服务器布局优先（存在时覆盖 localStorage 缓存）
  useEffect(() => {
    let cancelled = false;
    fetch(LAYOUT_URL, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(({ data }) => {
        if (cancelled) return;
        if (data && Array.isArray(data.nodes)) {
          setCanvas(data as CanvasState);
        }
      })
      .catch((err) =>
        console.warn("[canvas-sync] 加载服务器布局失败:", err)
      )
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [setCanvas]);

  // 防抖保存（跳过首次挂载）
  useEffect(() => {
    if (!loaded) return;
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch(LAYOUT_URL, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(canvas),
      }).catch((err) =>
        console.warn("[canvas-sync] 保存服务器布局失败:", err)
      );
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [canvas, loaded]);

  // 页面隐藏/关闭时立即 flush（防抖未触发的情况）
  const flush = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    fetch(LAYOUT_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(canvasRef.current),
      keepalive: true,
    }).catch(() => {
      /* 卸载时静默失败，localStorage 兜底 */
    });
  }, []);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
    };
  }, [flush]);

  return loaded;
}
