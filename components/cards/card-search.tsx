"use client";

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useReactFlow } from "reactflow";
import { Search, X, FileText, Tag, Hash } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { FreeCardData } from "./free-card-node";

/**
 * 画布卡片搜索组件
 *
 * 功能：
 *   1. 搜索卡片标题、内容、标签（全文搜索）
 *   2. 实时搜索（输入即搜，debounce 150ms）
 *   3. 搜索结果下拉列表，显示匹配类型（标题/内容/标签）
 *   4. 点击结果定位到卡片（setCenter + 放大）
 *   5. 搜索时高亮匹配卡片，暗化非匹配卡片（通过回调通知画布）
 *
 * 集成位置：浮在画布左上角，半透明背景
 */

interface CardSearchProps {
  /** 搜索匹配的节点 ID 集合（供画布高亮/暗化用） */
  onSearchResults?: (matchIds: Set<string> | null) => void;
}

/** 搜索匹配类型 */
type MatchType = "title" | "content" | "tag";

/** 搜索结果项 */
interface SearchResult {
  nodeId: string;
  title: string;
  matchType: MatchType;
  /** 匹配的标签名（matchType === "tag" 时有值） */
  matchedTag?: string;
  /** 内容匹配片段 */
  snippet?: string;
}

export function CardSearch({ onSearchResults }: CardSearchProps) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const { getNodes, setCenter } = useReactFlow();

  // 搜索逻辑（debounce 150ms）
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 150);
    return () => clearTimeout(timer);
  }, [query]);

  // 执行搜索
  const results = useMemo<SearchResult[]>(() => {
    const q = debouncedQuery.trim().toLowerCase();
    if (!q) return [];

    const allNodes = getNodes();
    const matched: SearchResult[] = [];

    for (const node of allNodes) {
      const data = node.data as FreeCardData | undefined;
      if (!data) continue;

      const title = (data.title || "").toLowerCase();
      const content = (data.content || "").toLowerCase();
      const tags = data.tags || [];

      // 优先级：标题 > 标签 > 内容
      if (title.includes(q)) {
        matched.push({
          nodeId: node.id,
          title: data.title || "未命名卡片",
          matchType: "title",
        });
      } else if (tags.some((t) => t.toLowerCase().includes(q))) {
        const matchedTag = tags.find((t) =>
          t.toLowerCase().includes(q)
        );
        matched.push({
          nodeId: node.id,
          title: data.title || "未命名卡片",
          matchType: "tag",
          matchedTag,
        });
      } else if (content.includes(q)) {
        // 提取匹配片段（前后各 30 字符）
        const idx = content.indexOf(q);
        const start = Math.max(0, idx - 30);
        const end = Math.min(content.length, idx + q.length + 30);
        const snippet =
          (start > 0 ? "..." : "") +
          data.content.substring(start, end) +
          (end < content.length ? "..." : "");
        matched.push({
          nodeId: node.id,
          title: data.title || "未命名卡片",
          matchType: "content",
          snippet,
        });
      }
    }

    return matched;
  }, [debouncedQuery, getNodes]);

  // 通知画布高亮匹配项
  useEffect(() => {
    if (debouncedQuery.trim()) {
      onSearchResults?.(new Set(results.map((r) => r.nodeId)));
    } else {
      onSearchResults?.(null);
    }
  }, [results, debouncedQuery, onSearchResults]);

  // 重置选中索引
  useEffect(() => {
    setActiveIndex(0);
  }, [debouncedQuery]);

  // 点击外部关闭下拉
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setFocused(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  /** 定位到指定节点（居中 + 放大） */
  const focusNode = useCallback(
    (nodeId: string) => {
      const node = getNodes().find((n) => n.id === nodeId);
      if (!node) return;
      const w = node.width ?? 280;
      const h = node.height ?? 150;
      // setCenter(x, y, { zoom, duration })
      // x/y 为节点中心点在画布坐标系中的位置
      setCenter(node.position.x + w / 2, node.position.y + h / 2, {
        zoom: 1.2,
        duration: 400,
      });
      setFocused(false);
    },
    [getNodes, setCenter]
  );

  /** 键盘导航 */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[activeIndex]) {
        focusNode(results[activeIndex].nodeId);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setQuery("");
      setFocused(false);
    }
  };

  /** 匹配类型图标 */
  const MatchIcon = ({ type }: { type: MatchType }) => {
    const iconClass = "w-3 h-3 flex-shrink-0";
    switch (type) {
      case "title":
        return <Hash className={cn(iconClass, "text-blue-500")} />;
      case "tag":
        return <Tag className={cn(iconClass, "text-green-500")} />;
      case "content":
        return <FileText className={cn(iconClass, "text-orange-500")} />;
    }
  };

  return (
    <div ref={containerRef} className="relative w-64">
      {/* 搜索输入框 */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={handleKeyDown}
          placeholder="搜索卡片标题、内容、标签..."
          className={cn(
            "w-full pl-8 pr-7 py-1.5 text-xs",
            "bg-background/95 backdrop-blur border border-border rounded-lg",
            "focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary",
            "placeholder:text-muted-foreground/60",
            "shadow-sm"
          )}
        />
        {query && (
          <button
            onClick={() => {
              setQuery("");
              onSearchResults?.(null);
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-accent text-muted-foreground"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* 搜索结果下拉列表 */}
      {focused && debouncedQuery.trim() && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-popover border border-border rounded-lg shadow-lg max-h-80 overflow-y-auto z-50">
          {results.length === 0 ? (
            <div className="px-3 py-4 text-xs text-muted-foreground text-center">
              未找到匹配的卡片
            </div>
          ) : (
            <>
              {/* 结果计数 */}
              <div className="px-3 py-1 text-[10px] text-muted-foreground border-b border-border/40">
                找到 {results.length} 个结果
              </div>
              {results.map((r, i) => (
                <button
                  key={r.nodeId}
                  onClick={() => focusNode(r.nodeId)}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={cn(
                    "w-full px-3 py-2 text-left text-xs flex items-start gap-2 transition-colors",
                    i === activeIndex
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50"
                  )}
                >
                  <MatchIcon type={r.matchType} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{r.title}</div>
                    {r.matchType === "tag" && r.matchedTag && (
                      <div className="text-[10px] text-green-600 truncate">
                        标签：{r.matchedTag}
                      </div>
                    )}
                    {r.matchType === "content" && r.snippet && (
                      <div className="text-[10px] text-muted-foreground truncate">
                        {r.snippet}
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
