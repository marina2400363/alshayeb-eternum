import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";

export default function RoomsHamburgerMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    const handleClickOutside = (e) => {
      if (!e.target.closest(".rooms-floating-menu-container")) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      document.addEventListener("click", handleClickOutside);
    }
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.removeEventListener("click", handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div className="rooms-floating-menu-container">
      <button 
        className={`rooms-floating-hamburger-btn ${isOpen ? "open" : ""}`} 
        onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }}
        aria-label="Menu"
        type="button"
      >
        <span className="rooms-ham-line"></span>
        <span className="rooms-ham-line"></span>
        <span className="rooms-ham-line"></span>
      </button>
      
      {isOpen && (
        <div className="rooms-floating-menu-dropdown">
          <button 
            className="rooms-floating-menu-item"
            onClick={() => {
              setIsOpen(false);
              setSearchParams({ step: "home" });
            }}
            type="button"
          >
            HOME
          </button>
          <a 
            className="rooms-floating-menu-item"
            href="https://www.instagram.com/alshayebexperience?igsh=bGY0dmxvZXAwd3dr" 
            target="_blank" 
            rel="noopener noreferrer"
            onClick={() => setIsOpen(false)}
          >
            INSTAGRAM
          </a>
          <a 
            className="rooms-floating-menu-item"
            href="https://www.tiktok.com/@alshayebexperience?_r=1&_t=ZS-97UW4Hhql9t" 
            target="_blank" 
            rel="noopener noreferrer"
            onClick={() => setIsOpen(false)}
          >
            TIKTOK
          </a>
        </div>
      )}
    </div>
  );
}
