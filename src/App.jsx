// src/App.jsx
import React, { useState, useEffect } from "react";
import Designer from "./designer/Designer.jsx";
import Home from "./Home.jsx";

export default function App() {
  const [view, setView] = useState("home");

  // Check URL on load: if returning from payment, go straight to designer
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("success") || params.get("session_id")) {
      setView("designer");
    }
  }, []);

  // Simple view switcher
  return (
    <>
      {view === "home" ? (
        <Home onStart={() => setView("designer")} />
      ) : (
        <Designer />
      )}
    </>
  );
}
