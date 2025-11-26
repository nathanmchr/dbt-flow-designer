import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

interface TooltipProps {
  children: React.ReactNode;
  content: React.ReactNode;
  disabled?: boolean;
}

export const Tooltip: React.FC<TooltipProps> = ({
  children,
  content,
  disabled = false,
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);

  const updatePosition = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPosition({
        top: rect.bottom,
        left: rect.left + rect.width / 2,
      });
    }
  };

  const handleMouseEnter = () => {
    if (disabled) return;
    updatePosition();
    setIsVisible(true);
  };

  const handleMouseLeave = () => {
    setIsVisible(false);
  };

  // Update position on scroll or resize when visible
  useEffect(() => {
    if (isVisible) {
      window.addEventListener("scroll", updatePosition, true);
      window.addEventListener("resize", updatePosition);
      return () => {
        window.removeEventListener("scroll", updatePosition, true);
        window.removeEventListener("resize", updatePosition);
      };
    }
  }, [isVisible]);

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className="inline-block"
      >
        {children}
      </div>
      {isVisible &&
        createPortal(
          <div
            className="tooltip-content fixed z-9999 pointer-events-none text-gray-600 dark:text-gray-400"
            style={{
              top: position.top,
              left: position.left,
              transform: "translateX(-50%) translateY(8px)",
            }}
          >
            {content}
          </div>,
          document.body
        )}
    </>
  );
};
