'use client';

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';

/**
 * 鐢ㄤ簬缈昏瘧鍚庣杩斿洖鐨勫姩鎬侀敊璇爜鍜屾垚鍔熸秷鎭€? *
 * 鍚庣杩斿洖鐨?key 鏄棤鍓嶇紑鐨勬墎骞冲瓧绗︿覆锛堝 'task_not_found'锛夛紝
 * 鍏ㄩ儴褰掑叆 backend 鍛藉悕绌洪棿銆傚鏋?key 涓嶅瓨鍦ㄥ垯鍘熸牱杩斿洖銆? */
export function useBackendMessage() {
  const t = useTranslations('backend');

  return useCallback((code: string): string => {
    try {
      return t(code as never);
    } catch {
      return code;
    }
  }, [t]);
}
