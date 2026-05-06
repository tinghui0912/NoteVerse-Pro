import { useRef, useCallback } from 'react';

interface UseLongPressOptions {
    onLongPress: () => void;
    delay?: number;
    threshold?: number;
    disabled?: boolean;
}

/**
 * 长按检测 Hook
 * @param onLongPress 长按触发的回调函数
 * @param delay 长按延迟时间（毫秒），默认 450ms
 * @param threshold 移动阈值（像素），超过此距离取消长按，默认 12px
 * @param disabled 是否禁用长按检测
 */
export function useLongPress({
    onLongPress,
    delay = 450,
    threshold = 12,
    disabled = false,
}: UseLongPressOptions) {
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const startPosRef = useRef<{ x: number; y: number } | null>(null);

    const cancel = useCallback(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        startPosRef.current = null;
    }, []);

    const start = useCallback(
        (e: React.TouchEvent | React.MouseEvent) => {
            if (disabled) return;

            // 获取起始位置
            const pos = 'touches' in e
                ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
                : { x: e.clientX, y: e.clientY };

            startPosRef.current = pos;

            timerRef.current = setTimeout(() => {
                onLongPress();
                timerRef.current = null;
            }, delay);
        },
        [onLongPress, delay, disabled]
    );

    const move = useCallback(
        (e: React.TouchEvent | React.MouseEvent) => {
            if (!timerRef.current || !startPosRef.current) return;

            const pos = 'touches' in e
                ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
                : { x: e.clientX, y: e.clientY };

            const dx = Math.abs(pos.x - startPosRef.current.x);
            const dy = Math.abs(pos.y - startPosRef.current.y);

            // 移动超过阈值，取消长按
            if (dx + dy > threshold) {
                cancel();
            }
        },
        [threshold, cancel]
    );

    // 返回绑定到元素的事件处理器
    return {
        onTouchStart: start,
        onTouchMove: move,
        onTouchEnd: cancel,
        onTouchCancel: cancel,
        onMouseDown: start,
        onMouseMove: move,
        onMouseUp: cancel,
        onMouseLeave: cancel,
    };
}
