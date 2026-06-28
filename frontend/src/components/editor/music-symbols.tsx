'use client';

import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

export type MusicSymbolProps = HTMLAttributes<HTMLSpanElement>;

const symbolBaseClass = 'inline-flex h-6 w-6 items-center justify-center font-[LelandText] text-[1.7rem] leading-none';

function SmuflSymbol({ glyph, className, style, ...props }: MusicSymbolProps & { glyph: string }) {
    return (
        <span
            aria-hidden="true"
            className={cn(symbolBaseClass, className)}
            style={{ fontFamily: 'LelandText, serif', ...style }}
            {...props}
        >
            {glyph}
        </span>
    );
}

export function TieSymbol(props: MusicSymbolProps) {
    return <SmuflSymbol glyph={'\uE1FD'} {...props} />;
}

export function SlurSymbol({ className, style, ...props }: MusicSymbolProps) {
    return (
        <SmuflSymbol
            glyph={'\uE1FD'}
            className={cn('scale-x-125 -translate-y-0.5', className)}
            style={{ transformOrigin: 'center', ...style }}
            {...props}
        />
    );
}

export function BeamSymbol(props: MusicSymbolProps) {
    return <SmuflSymbol glyph={'\uE1F3'} {...props} />;
}