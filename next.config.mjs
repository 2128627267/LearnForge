/** @type {import('next').NextConfig} */
const nextConfig = {
  // 启用实验性功能：serverActions（用于表单提交和数据变更）
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb", // 允许较大的请求体（数据导入/文件上传）
    },
  },
  // 静态资源缓存策略
  async headers() {
    return [
      {
        source: "/static/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
};

export default nextConfig;
