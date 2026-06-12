'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';

/**
 * 添加实体卡片 - 空声部时显示的占位添加按钮
 */
export const AddNoteCard = ({ onClick }: { onClick: () => void }) => {
    const t = useTranslations('editor');
    return (
        <Button
            variant="ghost"
            onClick={onClick}
            className="w-32 h-29.5 shrink-0 bg-gray-50 text-gray-900 rounded-lg flex flex-col items-center justify-center relative p-3 gap-2 border-dashed border-2 transition-all duration-300 hover:shadow-xl hover:-translate-y-2 shadow-sm"
        >
            <div className="flex flex-col items-center gap-1 text-muted-foreground">
                <Plus className="h-5 w-5" />
                <span className="text-xs font-semibold">{t('addEntity')}</span>
            </div>
        </Button>
    );
};
