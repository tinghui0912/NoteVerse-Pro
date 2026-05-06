'use client';

import { useTranslations } from 'next-intl';

/**
 * 用于翻译后端返回的动态错误码和成功消息。
 *
 * 后端返回的 key 是无前缀的扁平字符串（如 'task_not_found'），
 * 全部归入 backend 命名空间。如果 key 不存在则原样返回。
 */
export function useBackendMessage() {
  const t = useTranslations('backend');

  return (code: string): string => {
    try {
      return t(code as any);
    } catch {
      return code;
    }
  };
}
