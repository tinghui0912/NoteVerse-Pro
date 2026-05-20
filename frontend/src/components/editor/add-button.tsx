'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import {
    Plus,
    Equal as BeamIcon,
    Link as TieIcon,
    Spline as SlurIcon,
} from 'lucide-react';
import type { Articulation } from '@/types/score-types';
import { cn } from '@/lib/utils';

/**
 * 连线类型图标映射
 */
export const articulationIcons: Record<Articulation, React.ElementType> = {
    beam: BeamIcon,
    tie: TieIcon,
    slur: SlurIcon,
};

/**
 * 插入模式下悬停时显示的添加按钮
 */
export const AddButton = ({ onClick, className }: { onClick: () => void, className?: string }) => (
    <Button
        size="icon"
        className={cn("absolute z-10 h-8 w-8 rounded-full bg-primary text-primary-foreground shadow-lg top-1/2 -translate-y-1/2 transition-all duration-200", className)}
        onClick={e => {
            e.stopPropagation();
            onClick();
        }}
    >
        <Plus className="h-5 w-5" />
    </Button>
);
