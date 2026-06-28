'use client';

import React from 'react';
import type { Articulation } from '@/types/score-types';
import { BeamSymbol, SlurSymbol, TieSymbol } from './music-symbols';

export const articulationIcons: Record<Articulation, React.ElementType> = {
    beam: BeamSymbol,
    tie: TieSymbol,
    slur: SlurSymbol,
};