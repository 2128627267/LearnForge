/**
 * Vitest 全局测试 Setup
 *
 * - 引入 jest-dom 自定义匹配器（如 toBeInTheDocument / toHaveTextContent 等），
 *   并同时增强 Vitest 的 expect 类型，使 typecheck 也能识别这些匹配器。
 */
import "@testing-library/jest-dom/vitest";
