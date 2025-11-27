// src/Home.jsx
import React from "react";

export default function Home({ onStart }) {
  return (
    <div className="home-container">
      {/* --- HERO SECTION --- */}
      <section className="hero">
        <div className="hero-content">
          <div className="badge">Parametric Design Studio</div>
          <h1 className="hero-title">
            Light, <span className="gradient-text">shaped by you.</span>
          </h1>
          <p className="hero-sub">
            Create a one-of-a-kind lampshade in seconds. 
            We 3D print your unique design and ship it directly to your door.
          </p>
          <div className="hero-actions">
            <button className="btn-primary" onClick={onStart}>
              Start Designing
            </button>
            <button className="btn-secondary" onClick={() => {
              document.getElementById('how-it-works').scrollIntoView({ behavior: 'smooth' });
            }}>
              How it works
            </button>
          </div>
        </div>
        <div className="hero-image">
           {/* Uses your existing image */}
           <img src="/images/example-1.jpg" alt="Custom Lamp" />
        </div>
      </section>

      {/* --- VALUE PROPS --- */}
      <section className="features" id="how-it-works">
        <div className="feature-card">
          <div className="icon">✨</div>
          <h3>Truly Unique</h3>
          <p>No two lamps are alike. Use our parametric sliders to tweak the twist, scale, and texture of your lamp.</p>
        </div>
        <div className="feature-card">
          <div className="icon">🌱</div>
          <h3>Eco-Friendly</h3>
          <p>Printed on demand using biodegradable PLA materials. Zero inventory waste, 100% sustainable.</p>
        </div>
        <div className="feature-card">
          <div className="icon">📦</div>
          <h3>Made to Order</h3>
          <p>Once you checkout, our print farm gets to work. Your bespoke creation arrives in 5-7 days.</p>
        </div>
      </section>

      {/* --- SHOWCASE --- */}
      <section className="showcase">
        <div className="showcase-text">
          <h2>Gallery of possibilities</h2>
          <p>From subtle ripples to wild alien geometries.</p>
        </div>
        <div className="showcase-grid">
          <img src="/images/example-1.jpg" alt="Design Variant 1" />
          <img src="/images/example-2.jpg" alt="Design Variant 2" />
          {/* Duplicate for effect, or add more images if you have them */}
          <img src="/images/example-1.jpg" alt="Design Variant 3" style={{ filter: "hue-rotate(45deg)" }} />
        </div>
      </section>

      {/* --- FOOTER CTA --- */}
      <footer className="home-footer">
        <h2>Ready to create yours?</h2>
        <button className="btn-primary large" onClick={onStart}>
          Launch Designer
        </button>
        <div className="copyright">© 2025 Parametric Vase Co.</div>
      </footer>
    </div>
  );
}
