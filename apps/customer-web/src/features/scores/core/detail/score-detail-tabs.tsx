'use client';

import type { ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export interface ScoreDetailTabItem {
  value: string;
  label: string;
  content: ReactNode;
}

export function ScoreDetailTabs({
  tabs,
  value,
  onValueChange,
}: {
  tabs: ScoreDetailTabItem[];
  value?: string;
  onValueChange?: (value: string) => void;
}) {
  const first = tabs[0]?.value;
  if (!first) return null;

  return (
    <Tabs
      defaultValue={first}
      value={value}
      onValueChange={onValueChange}
      className="mt-6"
    >
      <TabsList className="h-auto flex-wrap justify-start bg-transparent p-0">
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.value}
            value={tab.value}
            className="rounded-none border-b-2 border-transparent bg-transparent px-4 py-3 shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none"
          >
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent key={tab.value} value={tab.value} className="mt-5">
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
