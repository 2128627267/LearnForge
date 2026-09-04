/**
 * 设置页面（Server Component 包装）
 *
 * 路径：/settings
 * 作用：作为 Server Component 入口，渲染设置面板客户端组件
 *
 * 设置面板内部负责：
 *   - AI 库配置（提供商/Key/模型/温度/轮换池/RAG）
 *   - 知识库管理（文档列表/导入/删除）
 *   - 数据管理（导出/导入/清空）
 */
import { SettingsPanel } from "@/components/settings/settings-panel";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div>
        <h1 className="text-2xl font-bold">设置</h1>
        <p className="text-sm text-muted-foreground mt-1">
          管理 AI 库配置、知识库与数据导入导出
        </p>
      </div>

      {/* 设置面板（客户端组件，负责数据交互） */}
      <SettingsPanel />
    </div>
  );
}
