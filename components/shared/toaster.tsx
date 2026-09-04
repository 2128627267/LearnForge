"use client";

import { Toaster as SonnerToaster } from "sonner";

/**
 * 全局消息提示组件
 * 基于 sonner，提供 toast.success / toast.error 等 API
 */
export function Toaster() {
  return (
    <SonnerToaster
      position="top-right"
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast: "bg-card text-card-foreground border-border",
        },
      }}
    />
  );
}

export { toast } from "sonner";
