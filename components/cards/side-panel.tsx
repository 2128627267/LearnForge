"use client";

import { useRef, useState, useMemo } from "react";
import { cn } from "@/lib/utils/cn";
import { toast } from "@/components/shared/toaster";
import type { CanvasState } from "@/lib/hooks/use-local-storage";
import {
  COLOR_CATEGORIES,
  CARD_COLOR_THRESHOLD,
  shouldShowColorLabels,
} from "@/lib/cards/color-categories";
import {
  Plus,
  Download,
  Upload,
  Trash2,
  HelpCircle,
  X,
  Search,
  ChevronRight,
  GitBranch,
  Package,
  GraduationCap,
  Sparkles,
  Palette,
  type LucideIcon,
} from "lucide-react";

/**
 * 侧边面板组件（整合工具栏 + 标签管理）
 *
 * 设计原则：
 * - 收起状态：仅显示一个圆形伸缩按钮
 * - 展开状态：显示完整功能选项（工具区 + 标签区）
 * - 视觉简洁：剔除冗余 UI 元素
 *
 * 圆形按钮固定在右侧中部，点击切换展开/收起。
 * 展开后面板浮在画布上层，不挤压画布空间。
 */

/**
 * 标签颜色调色板（使用 hex 色值，与 FreeCardNode 保持一致）
 * W3 修复：统一颜色系统，避免 SidePanel 用 Tailwind 类名而 FreeCardNode 用 hash 计算导致颜色不一致
 */
const TAG_COLORS = [
  { name: "蓝", hex: "#3b82f6" },
  { name: "绿", hex: "#22c55e" },
  { name: "紫", hex: "#a855f7" },
  { name: "橙", hex: "#f97316" },
  { name: "粉", hex: "#ec4899" },
  { name: "青", hex: "#14b8a6" },
  { name: "红", hex: "#ef4444" },
  { name: "灰", hex: "#6b7280" },
];

export interface TagInfo {
  name: string;
  count: number;
  color?: string;
}

type ToolAction =
  | "add"
  | "import"
  | "export"
  | "clear"
  | "help"
  | "export-tree"
  | "export-pack"
  | "import-learn"
  | "ai-bridge";

interface ToolButton {
  action: ToolAction;
  label: string;
  icon: LucideIcon;
  variant?: "default" | "outline" | "ghost" | "danger";
}

/** 画布基础工具 */
const TOOL_BUTTONS: ToolButton[] = [
  { action: "add", label: "添加卡片", icon: Plus, variant: "default" },
  { action: "import", label: "导入", icon: Upload, variant: "outline" },
  { action: "export", label: "导出", icon: Download, variant: "outline" },
  { action: "clear", label: "清空", icon: Trash2, variant: "danger" },
  { action: "help", label: "帮助", icon: HelpCircle, variant: "ghost" },
];

/** 学习系统适配工具（画布 → 单词学习） */
const LEARN_TOOL_BUTTONS: ToolButton[] = [
  {
    action: "export-tree",
    label: "单词树",
    icon: GitBranch,
    variant: "outline",
  },
  {
    action: "export-pack",
    label: "学习包",
    icon: Package,
    variant: "outline",
  },
  {
    action: "import-learn",
    label: "导入学习",
    icon: GraduationCap,
    variant: "default",
  },
  {
    action: "ai-bridge",
    label: "AI 转化",
    icon: Sparkles,
    variant: "outline",
  },
];

/** 颜色统计默认空 Map（常量引用，避免每次渲染新建实例） */
const EMPTY_COLOR_COUNTS = new Map<string, number>();

export function SidePanel({
  tags,
  selectedTags,
  onToggleTag,
  onAddTag,
  onRemoveTag,
  onClearSelection,
  onClearCanvas,
  cardCount = 0,
  colorCounts = EMPTY_COLOR_COUNTS,
  selectedColor = null,
  onSelectColor,
}: {
  tags: TagInfo[];
  selectedTags: string[];
  onToggleTag: (tag: string) => void;
  onAddTag: (name: string, color?: string) => void;
  onRemoveTag: (name: string) => void;
  onClearSelection: () => void;
  onClearCanvas: () => void;
  /** 画布卡片总数（用于阈值化显示颜色分类标签） */
  cardCount?: number;
  /** 各颜色分类的卡片数统计（Map<hex, count>） */
  colorCounts?: Map<string, number>;
  /** 当前按颜色筛选的选中色（null=未筛选） */
  selectedColor?: string | null;
  /** 切换颜色筛选（传 null 清除） */
  onSelectColor?: (color: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"tools" | "tags" | "colors">("tools");
  const [showHelp, setShowHelp] = useState(false);
  const [showAddTag, setShowAddTag] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [newTagColor, setNewTagColor] = useState(TAG_COLORS[0].hex);
  const [search, setSearch] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** 工具按钮点击处理 */
  const handleTool = (action: ToolAction) => {
    switch (action) {
      case "add":
        // 打开新建卡片对话框（对话框内填写后创建）
        window.dispatchEvent(new CustomEvent("canvas:add-card"));
        break;
      case "export":
        window.dispatchEvent(new CustomEvent("canvas:export"));
        toast.success("已导出画布数据");
        break;
      case "import":
        fileInputRef.current?.click();
        break;
      case "clear":
        if (confirm("确定清空画布？所有卡片将被删除（可重新导入恢复）")) {
          onClearCanvas();
          toast.success("画布已清空");
        }
        break;
      case "help":
        setShowHelp((v) => !v);
        break;
      case "export-tree":
        // 导出单词树（保留节点+连接关系）
        window.dispatchEvent(new CustomEvent("canvas:export-tree"));
        toast.success("已导出单词树");
        break;
      case "export-pack":
        // 导出为学习数据包（兼容 data_packs.json 格式）
        window.dispatchEvent(new CustomEvent("canvas:export-pack"));
        toast.success("已导出学习数据包");
        break;
      case "import-learn":
        // 直接导入到单词学习系统（创建 Card + WordProfile + 衍生关系）
        window.dispatchEvent(new CustomEvent("canvas:import-learn"));
        toast.info("正在导入到学习系统...");
        break;
      case "ai-bridge":
        // AI 将选中卡片转化为复式学习可用的单词/句子列表
        window.dispatchEvent(new CustomEvent("canvas:ai-bridge"));
        break;
    }
  };

  /** 文件导入处理 */
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string) as CanvasState;
        if (!data.nodes || !Array.isArray(data.nodes)) {
          throw new Error("文件格式不正确");
        }
        window.dispatchEvent(
          new CustomEvent("canvas:import", { detail: data })
        );
        toast.success(`已导入 ${data.nodes.length} 张卡片`);
      } catch (err) {
        toast.error("导入失败", { description: String(err) });
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  /** 添加标签 */
  const handleAddTag = () => {
    const name = newTag.trim();
    if (name) {
      onAddTag(name, newTagColor);
      setNewTag("");
      setShowAddTag(false);
    }
  };

  /** 过滤并按频率排序的标签 */
  const filteredTags = useMemo(() => {
    const s = search.toLowerCase();
    return tags
      .filter((t) => t.name.toLowerCase().includes(s))
      .sort((a, b) => b.count - a.count);
  }, [tags, search]);

  const maxCount = Math.max(1, ...tags.map((t) => t.count));

  return (
    <>
      {/* 隐藏的文件输入 */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* 圆形伸缩控制按钮（始终显示） */}
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "fixed right-4 top-1/2 -translate-y-1/2 z-30",
          "w-12 h-12 rounded-full",
          "flex items-center justify-center",
          "bg-primary text-primary-foreground shadow-lg",
          "hover:scale-110 hover:shadow-xl",
          "transition-all duration-300 ease-out",
          "border-2 border-background",
          open && "rotate-180"
        )}
        title={open ? "收起面板" : "展开面板"}
        aria-label={open ? "收起面板" : "展开面板"}
      >
        <ChevronRight className="w-5 h-5" />
      </button>

      {/* 展开后的浮动面板 */}
      <div
        className={cn(
          "fixed right-4 top-1/2 -translate-y-1/2 z-20",
          "w-72 mr-16",
          "bg-card border rounded-xl shadow-2xl",
          "transition-all duration-300 ease-out",
          "origin-right",
          open
            ? "opacity-100 scale-100 pointer-events-auto"
            : "opacity-0 scale-95 pointer-events-none"
        )}
      >
        {/* Tab 切换 */}
        <div className="flex border-b">
          <button
            onClick={() => setTab("tools")}
            className={cn(
              "flex-1 px-3 py-2.5 text-sm font-medium transition-colors",
              tab === "tools"
                ? "text-primary border-b-2 border-primary bg-primary/5"
                : "text-muted-foreground hover:text-foreground hover:bg-accent"
            )}
          >
            工具
          </button>
          <button
            onClick={() => setTab("tags")}
            className={cn(
              "flex-1 px-3 py-2.5 text-sm font-medium transition-colors",
              tab === "tags"
                ? "text-primary border-b-2 border-primary bg-primary/5"
                : "text-muted-foreground hover:text-foreground hover:bg-accent"
            )}
          >
            标签 {tags.length > 0 && `(${tags.length})`}
          </button>
          <button
            onClick={() => setTab("colors")}
            className={cn(
              "flex-1 px-3 py-2.5 text-sm font-medium transition-colors",
              tab === "colors"
                ? "text-primary border-b-2 border-primary bg-primary/5"
                : "text-muted-foreground hover:text-foreground hover:bg-accent"
            )}
          >
            颜色
          </button>
        </div>

        {/* 内容区 */}
        <div className="p-3 max-h-[60vh] overflow-y-auto">
          {tab === "tools" ? (
            <div className="space-y-3">
              {/* 工具按钮网格 */}
              <div className="grid grid-cols-2 gap-2">
                {TOOL_BUTTONS.map((btn) => {
                  const Icon = btn.icon;
                  return (
                    <button
                      key={btn.action}
                      onClick={() => handleTool(btn.action)}
                      className={cn(
                        "flex flex-col items-center gap-1 px-2 py-3 rounded-lg text-xs font-medium transition-colors",
                        btn.variant === "default" &&
                          "bg-primary text-primary-foreground hover:opacity-90",
                        btn.variant === "outline" &&
                          "border border-input hover:bg-accent",
                        btn.variant === "danger" &&
                          "border border-destructive/30 text-destructive hover:bg-destructive/10",
                        btn.variant === "ghost" &&
                          "text-muted-foreground hover:bg-accent"
                      )}
                    >
                      <Icon className="w-4 h-4" />
                      {btn.label}
                    </button>
                  );
                })}
              </div>

              {/* 帮助信息（可折叠） */}
              {showHelp && (
                <div className="mt-3 p-3 rounded-lg border bg-muted/30 text-xs space-y-1.5">
                  <p className="font-medium text-sm mb-2">使用帮助</p>
                  <p>• 拖拽卡片标题栏可移动卡片</p>
                  <p>• 卡片左右两侧圆点可拖出连线</p>
                  <p>• 鼠标滚轮缩放画布</p>
                  <p>• 拖拽空白处平移画布</p>
                  <p>• 点击卡片右上角 ✏️ 编辑</p>
                  <p>• 内容支持 LaTeX：$x^2$ 行内，$$\int$$ 块级</p>
                  <p>• 点击标签可筛选卡片</p>
                  <p>• 数据自动保存到浏览器本地</p>
                </div>
              )}

              {/* 学习系统适配工具（画布 → 单词学习） */}
              <div className="pt-3 border-t border-border/40">
                <p className="text-xs text-muted-foreground mb-2 font-medium">
                  学习系统适配
                </p>
                <div className="grid grid-cols-3 gap-1.5">
                  {LEARN_TOOL_BUTTONS.map((btn) => {
                    const Icon = btn.icon;
                    return (
                      <button
                        key={btn.action}
                        onClick={() => handleTool(btn.action)}
                        className={cn(
                          "flex flex-col items-center gap-1 px-1 py-2.5 rounded-lg text-[10px] font-medium transition-colors",
                          btn.variant === "default" &&
                            "bg-primary text-primary-foreground hover:opacity-90",
                          btn.variant === "outline" &&
                            "border border-input hover:bg-accent"
                        )}
                      >
                        <Icon className="w-4 h-4" />
                        {btn.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : tab === "colors" ? (
            <div className="space-y-3">
              {/* 颜色筛选说明 */}
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <Palette className="w-3 h-3" />
                  按颜色筛选
                </p>
                {selectedColor && (
                  <button
                    onClick={() => onSelectColor?.(null)}
                    className="text-xs text-primary hover:underline"
                  >
                    清除
                  </button>
                )}
              </div>

              {/* 颜色筛选色块（始终可用） */}
              <div className="grid grid-cols-4 gap-1.5">
                <button
                  onClick={() => onSelectColor?.(null)}
                  className={cn(
                    "flex flex-col items-center gap-1 px-1 py-1.5 rounded-lg text-[10px] border transition-colors",
                    !selectedColor
                      ? "border-primary text-primary bg-primary/5"
                      : "border-input text-muted-foreground hover:bg-accent"
                  )}
                  title="显示全部颜色"
                >
                  <span className="w-4 h-4 rounded-full border border-border bg-background flex items-center justify-center text-[8px] font-bold">
                    ✕
                  </span>
                  全部
                </button>
                {COLOR_CATEGORIES.map((c) => {
                  const active = selectedColor === c.hex;
                  const count = colorCounts.get(c.hex.toLowerCase()) ?? 0;
                  return (
                    <button
                      key={c.id}
                      onClick={() => onSelectColor?.(active ? null : c.hex)}
                      className={cn(
                        "flex flex-col items-center gap-1 px-1 py-1.5 rounded-lg text-[10px] border transition-colors",
                        active
                          ? "border-primary bg-primary/5"
                          : "border-input hover:bg-accent"
                      )}
                      title={`${c.name}色（${count} 张）`}
                    >
                      <span
                        className="w-4 h-4 rounded-full"
                        style={{ backgroundColor: c.hex }}
                      />
                      <span className={active ? "text-primary" : "text-muted-foreground"}>
                        {c.name}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* 智能显示：卡片数超过阈值时显示分类统计标签 */}
              {shouldShowColorLabels(cardCount) && (
                <div className="pt-2 border-t border-border/40 space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">
                    颜色分类（共 {cardCount} 张）
                  </p>
                  <div className="space-y-1">
                    {COLOR_CATEGORIES.filter(
                      (c) => (colorCounts.get(c.hex.toLowerCase()) ?? 0) > 0
                    ).map((c) => {
                      const count = colorCounts.get(c.hex.toLowerCase()) ?? 0;
                      const ratio = cardCount > 0 ? count / cardCount : 0;
                      const active = selectedColor === c.hex;
                      return (
                        <button
                          key={c.id}
                          onClick={() => onSelectColor?.(active ? null : c.hex)}
                          className={cn(
                            "w-full flex items-center gap-2 px-2 py-1 rounded-md transition-colors",
                            active ? "bg-primary/10" : "hover:bg-accent"
                          )}
                          title={`筛选${c.name}色卡片`}
                        >
                          <span
                            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: c.hex }}
                          />
                          <span className="text-xs flex-1 text-left">
                            {c.name}
                          </span>
                          {/* 占比条 */}
                          <span className="w-14 h-1.5 rounded-full bg-muted overflow-hidden">
                            <span
                              className="block h-full rounded-full transition-all"
                              style={{
                                width: `${Math.max(ratio * 100, 3)}%`,
                                backgroundColor: c.hex,
                              }}
                            />
                          </span>
                          <span className="text-xs text-muted-foreground w-8 text-right">
                            {count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    卡片数超过 {CARD_COLOR_THRESHOLD} 时自动显示分类统计，保持界面简洁
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {/* 搜索框 */}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索标签..."
                  className="w-full pl-8 pr-2 py-1.5 text-xs rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              {/* 已选筛选条件 */}
              {selectedTags.length > 0 && (
                <div className="p-2 rounded-md bg-muted/30">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-muted-foreground">
                      筛选中 ({selectedTags.length})
                    </span>
                    <button
                      onClick={onClearSelection}
                      className="text-xs text-primary hover:underline"
                    >
                      清除
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {selectedTags.map((t) => (
                      <span
                        key={t}
                        className="text-xs px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* 添加标签表单（可折叠） */}
              {showAddTag ? (
                <div className="p-2 rounded-md border bg-muted/30 space-y-2">
                  <input
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddTag()}
                    placeholder="标签名"
                    autoFocus
                    className="w-full px-2 py-1 text-xs rounded border border-input bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {TAG_COLORS.map((c) => (
                      <button
                        key={c.hex}
                        onClick={() => setNewTagColor(c.hex)}
                        className={cn(
                          "w-5 h-5 rounded-full transition-transform",
                          newTagColor === c.hex
                            ? "ring-2 ring-offset-1 ring-primary scale-110"
                            : "hover:scale-110"
                        )}
                        style={{ backgroundColor: c.hex }}
                        title={c.name}
                      />
                    ))}
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={handleAddTag}
                      className="flex-1 text-xs py-1 rounded bg-primary text-primary-foreground hover:opacity-90"
                    >
                      添加
                    </button>
                    <button
                      onClick={() => {
                        setShowAddTag(false);
                        setNewTag("");
                      }}
                      className="flex-1 text-xs py-1 rounded border hover:bg-accent"
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowAddTag(true)}
                  className="w-full flex items-center justify-center gap-1 py-1.5 text-xs rounded-md border border-dashed border-input hover:bg-accent text-muted-foreground"
                >
                  <Plus className="w-3 h-3" />
                  添加标签
                </button>
              )}

              {/* 标签列表 */}
              <div className="space-y-0.5">
                {filteredTags.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    {search ? "未找到匹配标签" : "暂无标签"}
                  </p>
                ) : (
                  filteredTags.map((tag) => {
                    const isSelected = selectedTags.includes(tag.name);
                    const fontSize = 0.75 + (tag.count / maxCount) * 0.4;
                    return (
                      <div
                        key={tag.name}
                        className={cn(
                          "group flex items-center justify-between gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors",
                          isSelected
                            ? "bg-primary/10"
                            : "hover:bg-accent"
                        )}
                        onClick={() => onToggleTag(tag.name)}
                      >
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{
                              backgroundColor: tag.color || "#9ca3af",
                            }}
                          />
                          <span
                            className="truncate"
                            style={{ fontSize: `${fontSize}rem` }}
                          >
                            {tag.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-muted-foreground">
                            {tag.count}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onRemoveTag(tag.name);
                            }}
                            title={`删除标签 ${tag.name}`}
                            aria-label={`删除标签 ${tag.name}`}
                            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-sm:opacity-100 p-0.5 rounded hover:bg-destructive/20 text-destructive transition-opacity"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
