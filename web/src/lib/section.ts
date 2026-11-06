import { useEffect, useSyncExternalStore } from 'react';

/**
 * Which master tab a page belongs to when its address doesn't say (a broadcast's own page
 * lives at /campaigns/… for both channels). The page announces it; the sidebar lights it up.
 */
export type NavSection = 'email' | 'whatsapp';

let current: NavSection | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function useNavSection(section: NavSection | null | undefined) {
  useEffect(() => {
    if (!section) return;
    current = section;
    emit();
    return () => {
      if (current === section) {
        current = null;
        emit();
      }
    };
  }, [section]);
}

export function useCurrentNavSection() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}
