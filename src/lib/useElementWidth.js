import { useCallback, useRef, useState } from 'react';

export function useElementWidth(enabled = true) {
  const elementRef = useRef(null);
  const observerRef = useRef(null);
  const [width, setWidth] = useState(0);

  const ref = useCallback((element) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    elementRef.current = element;

    if (!enabled || !element) {
      setWidth(0);
      return;
    }

    const update = (nextWidth) => {
      const rounded = Math.max(0, Math.round(nextWidth));
      setWidth((current) => (current === rounded ? current : rounded));
    };
    update(element.getBoundingClientRect().width);

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(([entry]) => update(entry.contentRect.width));
      observer.observe(element);
      observerRef.current = observer;
    }
  }, [enabled]);

  return [ref, width];
}
