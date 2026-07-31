"use client";

import { useState, useEffect, useCallback } from "react";

/**
 * 本地存储 Hook（localStorage 持久化）
 * 自动序列化/反序列化 JSON，支持 SSR 安全
 *
 * 使用 lazy initializer 在客户端首次渲染时即从 localStorage 读取，
 * 避免 SSR 初始值与客户端值不同步导致的闪烁与数据丢失。
 *
 * @param key localStorage 键名
 * @param initialValue 初始值（SSR 或 localStorage 为空时使用）
 */
export function useLocalStorage<T>(
  key: string,
  initialValue: T
): [T, (value: T | ((prev: T) => T)) => void, () => void] {
  // Lazy initializer：客户端首次渲染时即从 localStorage 读取
  // SSR 时 window 不存在，使用 initialValue
  const [stored, setStored] = useState<T>(() => {
    if (typeof window === "undefined") return initialValue;
    try {
      const item = window.localStorage.getItem(key);
      if (item !== null) {
        const parsed = JSON.parse(item);
        // 保护：如果解析结果为 null/undefined，回退到 initialValue
        // 避免 localStorage 中存了 "null" 导致后续读取报错
        return parsed === null || parsed === undefined ? initialValue : parsed;
      }
    } catch (err) {
      // W6 修复：JSON.parse 失败时清除损坏的数据，避免持续失败
      console.warn(`[localStorage] 读取 ${key} 失败，已清除损坏数据:`, err);
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* 忽略 removeItem 错误 */
      }
    }
    return initialValue;
  });

  // 监听其他标签页的 storage 事件（可选同步）
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key !== key || e.newValue === null) return;
      try {
        const parsed = JSON.parse(e.newValue);
        setStored(parsed === null || parsed === undefined ? initialValue : parsed);
      } catch {
        /* 忽略其他标签页写入的损坏数据 */
      }
    };
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // 写入
  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      setStored((prev) => {
        const next = value instanceof Function ? value(prev) : value;
        try {
          window.localStorage.setItem(key, JSON.stringify(next));
        } catch (err) {
          console.warn(`[localStorage] 写入 ${key} 失败:`, err);
        }
        return next;
      });
    },
    [key]
  );

  // 删除
  const remove = useCallback(() => {
    try {
      window.localStorage.removeItem(key);
    } catch (err) {
      console.warn(`[localStorage] 删除 ${key} 失败:`, err);
    }
    setStored(initialValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return [stored, setValue, remove];
}

/**
 * 画布数据类型
 */
export interface CanvasState {
  nodes: Array<{
    id: string;
    type: string;
    position: { x: number; y: number };
    data: Record<string, unknown>;
    width?: number;
    zIndex?: number;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
    /** 边类型（React Flow edge type，如 "freeEdge"） */
    type?: string;
    /** 边数据（含标签文字等） */
    data?: { label?: string };
  }>;
  tags: Array<{ name: string; color?: string }>;
  /** 视口位置（用于恢复画布位置） */
  viewport?: { x: number; y: number; zoom: number };
}

/** 画布数据存储 key */
export const CANVAS_STORAGE_KEY = "learnforge-canvas";

/**
 * 画布数据持久化 Hook
 */
export function useCanvasStorage() {
  return useLocalStorage<CanvasState>(CANVAS_STORAGE_KEY, {
    nodes: [],
    edges: [],
    tags: [],
  });
}
