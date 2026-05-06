'use client';

import React, { createContext, useContext, ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';

/**
 * Share Context 类型
 */
interface ShareContextType {
    /** 分享 token，从 URL 参数中自动读取 */
    shareToken: string | undefined;
    /** 是否处于分享访问模式 */
    isShareMode: boolean;
}

const ShareContext = createContext<ShareContextType>({
    shareToken: undefined,
    isShareMode: false,
});

/**
 * 使用 Share Context
 * 自动从 URL 读取 shareToken 参数
 */
export function useShare(): ShareContextType {
    return useContext(ShareContext);
}

/**
 * Share Context Provider
 * 包裹需要访问分享信息的组件
 */
export function ShareProvider({ children }: { children: ReactNode }) {
    const searchParams = useSearchParams();
    const shareTokenFromUrl = searchParams.get('shareToken');

    const value: ShareContextType = {
        shareToken: shareTokenFromUrl ?? undefined,
        isShareMode: !!shareTokenFromUrl,
    };

    return (
        <ShareContext.Provider value={value}>
            {children}
        </ShareContext.Provider>
    );
}

export default ShareContext;
