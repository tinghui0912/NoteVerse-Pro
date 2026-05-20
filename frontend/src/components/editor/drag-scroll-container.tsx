'use client';

import React, { useRef, useCallback } from 'react';
import { cn } from '@/lib/utils';

/**
 * 鼠标拖拽滚动 hook
 */
const useDragScroll = () => {
    const ref = useRef<HTMLDivElement>(null);
    const isDragging = useRef(false);
    const startX = useRef(0);
    const scrollLeft = useRef(0);

    const onMouseDown = useCallback((e: React.MouseEvent) => {
        if (!ref.current) return;
        isDragging.current = true;
        startX.current = e.pageX - ref.current.offsetLeft;
        scrollLeft.current = ref.current.scrollLeft;
        ref.current.style.cursor = 'grabbing';
    }, []);

    const onMouseUp = useCallback(() => {
        isDragging.current = false;
        if (ref.current) ref.current.style.cursor = 'grab';
    }, []);

    const onMouseMove = useCallback((e: React.MouseEvent) => {
        if (!isDragging.current || !ref.current) return;
        e.preventDefault();
        const x = e.pageX - ref.current.offsetLeft;
        const walk = (x - startX.current) * 1.5; // 滚动速度系数
        ref.current.scrollLeft = scrollLeft.current - walk;
    }, []);

    const onMouseLeave = useCallback(() => {
        isDragging.current = false;
        if (ref.current) ref.current.style.cursor = 'grab';
    }, []);

    return { ref, onMouseDown, onMouseUp, onMouseMove, onMouseLeave };
};

/**
 * 可拖拽滚动容器组件
 */
export const DragScrollContainer = ({
    children,
    className,
    onContainerMouseLeave
}: {
    children: React.ReactNode;
    className?: string;
    onContainerMouseLeave?: () => void;
}) => {
    const { ref, onMouseDown, onMouseUp, onMouseMove, onMouseLeave } = useDragScroll();
    return (
        <div
            ref={ref}
            className={cn("flex items-center gap-4 px-4 py-2 overflow-x-auto flex-1 min-w-0 hide-scrollbar cursor-grab select-none", className)}
            onMouseDown={onMouseDown}
            onMouseUp={onMouseUp}
            onMouseMove={onMouseMove}
            onMouseLeave={() => {
                onMouseLeave();
                onContainerMouseLeave?.();
            }}
        >
            {children}
        </div>
    );
};
