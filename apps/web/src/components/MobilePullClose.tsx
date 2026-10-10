import { useRef, useCallback } from 'react';
import { motion, useMotionValue, useTransform, type PanInfo } from 'framer-motion';

interface MobilePullCloseProps {
  /** Called when user pulls down past threshold */
  onClose: () => void;
  /** Pull distance threshold to trigger close (default 100px) */
  threshold?: number;
  children: React.ReactNode;
}

/**
 * Wraps content on mobile with a pull-down-to-close gesture.
 * Only active on screens < md (768px) and touch devices.
 */
export function MobilePullClose({ onClose, threshold = 100, children }: MobilePullCloseProps) {
  const isMobile = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse) and (max-width: 767px)').matches;
  const y = useMotionValue(0);
  const opacity = useTransform(y, [0, threshold], [1, 0.5]);
  const scale = useTransform(y, [0, threshold], [1, 0.96]);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleDragEnd = useCallback((_: unknown, info: PanInfo) => {
    if (info.offset.y > threshold) {
      onClose();
    }
  }, [onClose, threshold]);

  if (!isMobile) {
    return <>{children}</>;
  }

  return (
    <motion.div
      ref={containerRef}
      style={{ y, opacity, scale }}
      drag="y"
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0, bottom: 0.6 }}
      onDragEnd={handleDragEnd}
      className="relative"
    >
      {/* Pull handle indicator */}
      <div className="sticky top-0 z-30 flex items-center justify-center py-2 md:hidden">
        <div className="h-1 w-10 rounded-full bg-zinc-300" />
      </div>
      {children}
    </motion.div>
  );
}
