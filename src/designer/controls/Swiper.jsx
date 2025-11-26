// src/designer/controls/Swiper.jsx
import React, { useRef } from "react";

export default function Swiper({ options, value, onChange }) {
  const scrollRef = useRef(null);

  const scroll = (offset) => {
    if (scrollRef.current) {
      scrollRef.current.scrollBy({ left: offset, behavior: "smooth" });
    }
  };

  return (
    <div className="swiper-wrap">
      <button 
        className="swiper-arrow left" 
        onClick={() => scroll(-120)} 
        title="Scroll Left"
        tabIndex={-1} // prevent focus stopping on arrows
      >
        ‹
      </button>
      
      <div className="swiper-scroll" ref={scrollRef}>
        {options.map((opt) => {
          const isSelected = value === opt.value;
          return (
            <button
              key={opt.value}
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
        onClick={() => scroll(120)} 
        title="Scroll Right"
        tabIndex={-1}
      >
        ›
      </button>
    </div>
  );
}
