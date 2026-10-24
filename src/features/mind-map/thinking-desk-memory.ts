import { useCallback, useRef, useState } from 'react';
import type { ThinkingEntry } from '../../../shared/mind-map';

type EntryChoice = { navigation: ThinkingEntry[] | undefined; nodeId: string } | null;

export function useThinkingDeskMemory() {
  const [query, setQuery] = useState('');
  const [choice, setChoice] = useState<EntryChoice>(null);
  const scrollPositions = useRef(new Map<string, number>());
  const getScrollPosition = useCallback((key: string) => scrollPositions.current.get(key) ?? 0, []);
  const rememberScroll = useCallback((key: string, top: number) => {
    scrollPositions.current.set(key, top);
  }, []);
  return { query, setQuery, choice, setChoice, getScrollPosition, rememberScroll };
}

export type ThinkingDeskMemory = ReturnType<typeof useThinkingDeskMemory>;
