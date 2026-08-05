'use client';

import type React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface LibraryFilterBarProps {
  searchInput: string;
  sort: string;
  hasSearch: boolean;
  onSearchInputChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onSortChange: (value: string) => void;
  onClearSearch: () => void;
  t: (key: string) => string;
}

export function LibraryFilterBar({
  searchInput,
  sort,
  hasSearch,
  onSearchInputChange,
  onSubmit,
  onSortChange,
  onClearSearch,
  t,
}: LibraryFilterBarProps) {
  return (
    <form
      className="mb-5 flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm sm:flex-row sm:items-center"
      onSubmit={onSubmit}
    >
      <Input
        value={searchInput}
        onChange={(event) => onSearchInputChange(event.target.value)}
        placeholder={t('searchPlaceholder')}
        className="sm:max-w-sm"
      />
      <Select value={sort} onValueChange={onSortChange}>
        <SelectTrigger className="sm:w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="updated_desc">{t('sortUpdatedDesc')}</SelectItem>
          <SelectItem value="name_asc">{t('sortNameAsc')}</SelectItem>
        </SelectContent>
      </Select>
      <Button type="submit">{t('search')}</Button>
      {hasSearch ? (
        <Button type="button" variant="ghost" onClick={onClearSearch}>
          {t('clearSearch')}
        </Button>
      ) : null}
    </form>
  );
}
