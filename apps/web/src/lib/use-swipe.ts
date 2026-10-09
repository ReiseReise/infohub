import { useState, useCallback, useRef } from 'react';

export type SwipeDirection = 'left' | 'right' | null;

export interface UseSwipeOptions {
  /** Threshold in px to trigger the action (default 80) */
  threshold?: number;
  /** Max drag distance in px (default 120) */
  maxDrag?: number;
  /** Called when swiped left past threshold */
  onSwipeLeft?: () => void;
  /** Called when swiped right past threshold */
  onSwipeRight?: () => void;
}

export interface UseSwipeReturn {
  /** Current drag offset (px) – use for translateX */
  offsetX: number;
  /** Whether we're actively dragging */
  isDragging: boolean;
  /** Direction hint while dragging */
  direction: SwipeDirection;
  /** Whether the swipe action was triggered (for animation flash) */
  triggered: SwipeDirection;
  /** Handlers to spread on the container element */
  handlers: {
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: () => void;
  };
}

/**
 * Touch-only swipe gesture hook for list items.
 * Only activates on touch devices (pointer: coarse).
 */
export function useSwipe(options: UseSwipeOptions = {}): UseSwipeReturn {
  const { threshold = 80, maxDrag = 120, onSwipeLeft, onSwipeRight } = options;

  const [offsetX, setOffsetX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [triggered, setTriggered] = useState<SwipeDirection>(null);

  const startX = useRef(0);
  const startY = useRef(0);
  const isTracking = useRef(false);
  const directionLocked = useRef<'horizontal' | 'vertical' | null>(null);

  const direction: SwipeDirection = offsetX > 20 ? 'right' : offsetX < -20 ? 'left' : null;

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    // Only work on coarse pointer (touch) devices
    if (!window.matchMedia('(pointer: coarse)').matches) return;
    const touch = e.touches[0];
    startX.current = touch.clientX;
    startY.current = touch.clientY;
    isTracking.current = true;
    directionLocked.current = null;
    setTriggered(null);
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isTracking.current) return;
    const touch = e.touches[0];
    const dx = touch.clientX - startX.current;
    const dy = touch.clientY - startY.current;

    // Lock direction on first significant movement
    if (!directionLocked.current) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        directionLocked.current = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
      }
      if (directionLocked.current !== 'horizontal') {
        isTracking.current = false;
        return;
      }
    }

    if (directionLocked.current === 'horizontal') {
      // Prevent vertical scroll while swiping horizontally
      e.preventDefault();
      const clamped = Math.max(-maxDrag, Math.min(maxDrag, dx));
      setOffsetX(clamped);
      setIsDragging(true);
    }
  }, [maxDrag]);

  const onTouchEnd = useCallback(() => {
    if (!isTracking.current && !isDragging) return;
    isTracking.current = false;

    if (offsetX < -threshold && onSwipeLeft) {
      setTriggered('left');
      onSwipeLeft();
    } else if (offsetX > threshold && onSwipeRight) {
      setTriggered('right');
      onSwipeRight();
    }

    // Reset position
    setOffsetX(0);
    setIsDragging(false);

    // Clear triggered state after animation
    setTimeout(() => setTriggered(null), 400);
  }, [offsetX, threshold, onSwipeLeft, onSwipeRight, isDragging]);

  return {
    offsetX,
    isDragging,
    direction,
    triggered,
    handlers: { onTouchStart, onTouchMove, onTouchEnd },
  };
}
