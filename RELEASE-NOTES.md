# LearnForge v0.2.0 Release Notes

发布日期：2026-08-28 · 分支：`release/iter202608` → `main` · 上个版本：v0.1.0（初版）

## 新功能

### 时间线（`/timeline`）
历史大事件可视化整理页：
- 多时间线管理（左侧选择器），事件支持 **point**（时点）与 **period**（时段）两种类型
- 支持公元前年份（负数存储），水平时间轴滚动浏览
- AI 自然语言批量解析：输入一段文字自动提取事件并落库（`/api/ai/timeline-parse`）
- 事件卡片详情按需展开（点击原地展开/收起）
- 重合事件**分层分色**：区间图贪心染色（逐层上移 + 8 色板避让）
- 交互迭代后验证：188/188 单测（含 view-scale 29 例）、API CRUD 冒烟、浏览器实测

### 局域网访问
- `start-dev-lan.bat` 一键开启局域网模式（`LAN_ACCESS=1`），支持手机端协同
- 安全加固：局域网模式下禁用令牌自动下发端点（防伪造 `Host: localhost` 窃取令牌），
  各设备首次访问时浏览器弹窗手动输入一次令牌（localStorage 记住）

## 2026-08 迭代回顾（自 v0.1.0 以来的主要变更）

| # | 功能 | 说明 |
|---|------|------|
| F1 | 卡片文字高光编辑 | 自研 Tiptap 高亮 Mark + 多色调色板 + sanitize 净化收窄 |
| F2 | 卡片颜色分类 | 命名色板 + 阈值标签显隐 + 颜色筛选 |
| F3 | 卡片数据实时存储 | 乐观锁 revision 协议（冲突 409 + 合并）+ SaveQueue 指数退避 + 快照恢复（20 份）+ 变更日志（200 条）+ SyncAdapter 抽象 |
| F4 | 一键部署配置 | `setup.ps1` / `setup.sh` + `docs/DEPLOYMENT.md` + 行尾规范 |
| F5 | 插件/技能系统 | 声明式 manifest + 注册表 + 管理 API/UI + 权限作用域 + 审计 + function-calling 执行期协议 |
| E  | 测试基础设施 | Vitest 4 + @testing-library/react + jsdom，lib/ 覆盖率门禁 ≥80% |

另含模型接入协议（`/api/cards/batch`、`/api/cards/connect`、`/api/ai/capabilities`）、
CardDialog AI 整合（卡片编辑唯一入口 + 运行时模型选择 + 项目记忆抽屉）、
README 全面重写（英文 + 新增简体中文版）。

## 质量门禁（发布基线 @ 79fdebf）

| 检查 | 结果 |
|------|------|
| typecheck | 0 错误 |
| lint | 0 警告 0 错误（既有问题清零） |
| test | **188/188 通过**（18 文件） |
| build | 通过 |
| 冒烟 | 全部页面路由 200；时间线 API CRUD（创建/查询/更新/删除）端到端通过 |

## 升级说明

- 数据库 schema 有新增模型（Timeline/TimelineEvent）：已有用户执行 `npx prisma db push`（或 `npm run setup`）即可，无破坏性迁移
- 若启用局域网模式，需配置 `LOCAL_ACCESS_TOKEN`（见 `.env.example` 与 `docs/DEPLOYMENT.md`）
