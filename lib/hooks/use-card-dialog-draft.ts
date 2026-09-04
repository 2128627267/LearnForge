"use client";

import { useCallback, useState } from "react";

/** 学习模式：深度学习（canvas+AI+关系线）/ 复式学习（quiz+review）/ 两者 */
export type LearningMode = "deep" | "review" | "both";

/** AI 侧栏各 Tab 的输入缓存 */
export interface CardAiDraft {
  chatInput: string;
  chatMessages: Array<{ role: "user" | "assistant"; content: string }>;
  generateInput: string;
  extendInput: string;
  mathInput: string;
  mathResult: string;
}

/** 卡片对话框草稿（表单 + AI 侧栏输入，localStorage 持久化） */
export interface CardDraft {
  title: string;
  content: string;
  tags: string[];
  color: string;
  learningMode: LearningMode;
  width: number;
  ai: CardAiDraft;
}

/** 默认草稿（新建卡片初始值） */
export const DEFAULT_DRAFT: CardDraft = {
  title: "",
  content: "",
  tags: [],
  color: "#3b82f6",
  learningMode: "deep",
  width: 280,
  ai: {
    chatInput: "",
    chatMessages: [],
    generateInput: "",
    extendInput: "",
    mathInput: "",
    mathResult: "",
  },
};

/** 草稿 localStorage key（新建用 new，编辑用卡片 id） */
export function cardDraftKey(cardId: string | null): string {
  return `card-dialog:draft:${cardId ?? "new"}`;
}

/** 读取草稿（损坏数据清除并返回 null） */
export function readCardDraft(key: string): CardDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CardDraft;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      ...DEFAULT_DRAFT,
      ...parsed,
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      ai: { ...DEFAULT_DRAFT.ai, ...(parsed.ai ?? {}) },
    };
  } catch (err) {
    console.warn(`[card-draft] 读取草稿 ${key} 失败，已清除损坏数据:`, err);
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* 忽略 */
    }
    return null;
  }
}

/**
 * 卡片对话框草稿 Hook
 * 每次 setDraft 即写入 localStorage（自动缓存）；clearDraft 在保存成功后调用
 */
export function useCardDialogDraft(cardId: string | null) {
  const key = cardDraftKey(cardId);
  const [draft, setDraftState] = useState<CardDraft | null>(() =>
    readCardDraft(key)
  );

  const setDraft = useCallback(
    (next: CardDraft | ((prev: CardDraft | null) => CardDraft)) => {
      setDraftState((prev) => {
        const resolved = next instanceof Function ? next(prev) : next;
        try {
          window.localStorage.setItem(key, JSON.stringify(resolved));
        } catch (err) {
          console.warn(`[card-draft] 写入草稿 ${key} 失败:`, err);
        }
        return resolved;
      });
    },
    [key]
  );

  const clearDraft = useCallback(() => {
    setDraftState(null);
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* 忽略 */
    }
  }, [key]);

  return { draft, setDraft, clearDraft };
}
