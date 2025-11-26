// src/designer/controls/Swiper.jsx
import React, { useRef, useEffect } from "react";

export default function Swiper({ options, value, onChange }) {
  const containerRef = useRef(null);
  const selectedRef = useRef(null);

  // Helper to find current index
  const currentIndex = options.findIndex((o) => o.value === value);

  // Auto-scroll to center selection whenever it changes
  useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current.scrollIntoView({
        behavior: "smooth",
        inline: "center",
        block: "nearest",
      });
    }
  }, [value]);

  const onArrowClick = (dir) => {
    if (!options.length) return;
    
    // Calculate next index with infinite wrapping
    let nextIndex = currentIndex + dir;
    if (nextIndex < 0) nextIndex = options.length - 1;
    if (nextIndex >= options.length) nextIndex = 0;

    // Select it immediately
    onChange(options[nextIndex].value);
  };

  return (
    <div className="swiper-wrap">
      <button
        className="swiper-arrow left"
        onClick={() => onArrowClick(-1)}
        title="Previous"
        tabIndex={-1}
      >
        ‹
      </button>

      <div className="swiper-scroll" ref={containerRef}>
        {options.map((opt) => {
          const isSelected = value === opt.value;
          return (
            <button
              key={opt.value}
              ref={isSelected ? selectedRef : null}
              className={`swiper-card ${isSelected ? "selected" : ""}`}
              onClick={() => onChange(opt.value)}
              title={opt.label}
            >
              <div className="swiper-label">{opt.label}</div>
            </button>
          );
        })}
      </div>

      <button
        className="swiper-arrow right"
        onClick={() => onArrowClick(1)}
        title="Next"
        tabIndex={-1}
      >
        ›
      </button>
    </div>
  );
}
