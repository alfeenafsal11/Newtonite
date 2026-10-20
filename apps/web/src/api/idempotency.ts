import { useRef, useCallback } from 'react';

export function useIntentKey() {
  const keyRef = useRef<string>(crypto.randomUUID());

  const getKey = useCallback(() => {
    return keyRef.current;
  }, []);

  const resetKey = useCallback(() => {
    keyRef.current = crypto.randomUUID();
    return keyRef.current;
  }, []);

  return {
    get key() {
      return keyRef.current;
    },
    getKey,
    resetKey,
    reset: resetKey,
  };
}
