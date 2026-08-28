/**
 * 访问令牌引导脚本（内联至 <head>，在任何数据请求发起前执行）
 *
 * 与 middleware.ts 的 LOCAL_ACCESS_TOKEN 校验、/api/local-token 端点配合，
 * 覆盖三类访问场景：
 *
 *   1. 本机访问（默认 start-dev.bat，回环绑定）：
 *      从 /api/local-token（仅 localhost Host 可访问）自动获取令牌，
 *      拦截 fetch 自动附加 x-local-token header —— 行为与旧版一致。
 *
 *   2. 局域网访问（start-dev-lan.bat，绑定 0.0.0.0 + LAN_ACCESS=1）：
 *      自动下发端点已被禁用（防伪造 Host 窃取令牌），任一 /api/*
 *      请求返回 401 时弹出输入框，用户输入 LOCAL_ACCESS_TOKEN
 *      （见服务器 .env.local）后存入 localStorage 并刷新页面，
 *      之后自动携带 —— 每台设备只需输入一次。
 *
 *   3. 未配置 LOCAL_ACCESS_TOKEN：所有请求放行，无任何干扰。
 *
 * 约束：脚本为纯 ES5 内联字符串（无模块 / 无构建转换），
 * 必须在首个 /api/* 请求前完成 fetch 拦截器安装。
 */

/** 手动输入令牌在 localStorage 中的持久化键 */
export const MANUAL_TOKEN_STORAGE_KEY = "learnforge-local-token";

/** 本次会话内用户已取消输入的标志键（sessionStorage，刷新页面后重置） */
const TOKEN_DISMISSED_KEY = "learnforge-token-dismissed";

/**
 * 引导脚本本体（ES5）
 *
 * 执行流程：
 *   a. 立即安装 fetch 拦截器（读取可变变量 currentToken，保证最早的
 *      API 请求也在监控范围内，避免安装前发出的 401 丢失）；
 *   b. 优先读取 localStorage 中手动保存的令牌（手机 / LAN 模式），
 *      命中则不再请求自动下发端点；
 *   c. 否则异步请求 /api/local-token（仅本机 localhost 场景返回令牌），
 *      成功后更新 currentToken；
 *   d. 拦截器捕获 /api/* 响应 401（服务端要求令牌而本端无有效令牌）：
 *      延迟 800ms 等待自动获取完成（本机场景令牌获取与本页首请求
 *      并发，时序性 401 会自愈，不应弹窗），确认仍无有效令牌后
 *      弹出输入框；输入非空则持久化并刷新页面。
 */
export const tokenBootstrapScript = `
(function() {
  try {
    var STORAGE_KEY = ${JSON.stringify(MANUAL_TOKEN_STORAGE_KEY)};
    var DISMISSED_KEY = ${JSON.stringify(TOKEN_DISMISSED_KEY)};
    var currentToken = null; // 当前生效令牌（拦截器读取的可变引用）
    var prompting = false;   // 输入框防重入（并发 401 只弹一次）

    // 安装 fetch 拦截器：同源 /api/* 请求自动附加令牌 + 监听 401
    function hookFetch() {
      if (window.__lfTokenHooked) return;
      window.__lfTokenHooked = true;
      var orig = window.fetch;
      window.fetch = function(input, init) {
        init = init || {};
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        // /api/local-token 自身不附加令牌（middleware 放行，避免干扰）
        var isApi = url.indexOf('/api/') !== -1 && url.indexOf('/api/local-token') === -1;
        if (isApi && currentToken) {
          var headers = new Headers(init.headers || {});
          if (!headers.has('x-local-token')) {
            headers.set('x-local-token', currentToken);
            init.headers = headers;
          }
        }
        var p = orig.call(this, input, init);
        if (isApi) {
          p = p.then(function(resp) {
            if (resp.status === 401) askForToken();
            return resp;
          });
        }
        return p;
      };
    }

    // 401 处理：引导输入访问令牌，保存后刷新页面使新令牌立即生效
    function askForToken() {
      if (prompting) return;
      // 用户本次会话已主动取消：不再打扰（刷新页面后重新允许）
      try {
        if (sessionStorage.getItem(DISMISSED_KEY)) return;
      } catch (e) {}
      prompting = true;
      setTimeout(function() {
        // 本机场景：自动获取的令牌已在此期间送达（时序性 401 自愈），无需弹窗
        if (currentToken && window.__lfTokenAuto) {
          prompting = false;
          return;
        }
        var input = window.prompt('此服务已启用访问令牌校验。\\n请输入 LOCAL_ACCESS_TOKEN（见服务器 .env.local 配置）：');
        if (input !== null) {
          var t = String(input).trim();
          if (t) {
            try { localStorage.setItem(STORAGE_KEY, t); } catch (e) {}
            window.location.reload();
            return;
          }
        } else {
          // 取消输入：本会话内不再弹出
          try { sessionStorage.setItem(DISMISSED_KEY, '1'); } catch (e) {}
        }
        prompting = false;
      }, 800);
    }

    hookFetch(); // 立即安装，保证最早发出的 API 请求也被监控

    // 1) 手动保存的令牌优先（手机 / LAN 模式）
    try {
      var manual = localStorage.getItem(STORAGE_KEY);
      if (manual) {
        currentToken = manual;
        return; // 已有令牌，无需请求自动下发端点
      }
    } catch (e) {}

    // 2) 本机自动获取（/api/local-token 仅 localhost Host 且非 LAN 模式时返回令牌）
    fetch('/api/local-token').then(function(r) {
      return r.ok ? r.json() : null;
    }).then(function(d) {
      if (d && d.token) {
        currentToken = d.token;
        window.__lfTokenAuto = true; // 标记令牌来源为自动获取
      }
    }).catch(function() {});
  } catch (e) {}
})();
`;
