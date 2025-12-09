"use client";

import { useCallback, useRef, useState } from "react";

export function useLocalStorage<T>(key: string, initialValue: T) {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item =
        typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
      return item ? JSON.parse(item) : initialValue;
    } catch (_error) {
      return initialValue;
    }
  });
  const [isLoaded] = useState(true);
  const initialValueRef = useRef(initialValue);

  const setValue = useCallback(
    (value: T | ((val: T) => T)) => {
      try {
        setStoredValue((prev) => {
          const valueToStore = value instanceof Function ? value(prev) : value;
          window.localStorage.setItem(key, JSON.stringify(valueToStore));
          return valueToStore;
        });
      } catch (_error) {}
    },
    [key],
  );

  const removeValue = useCallback(() => {
    try {
      window.localStorage.removeItem(key);
      setStoredValue(initialValueRef.current);
    } catch (_error) {}
  }, [key]);

  return { value: storedValue, setValue, removeValue, isLoaded };
}
