import React, { useEffect, useState } from 'react';

const RoomsLoadingScreen = ({ isLoading }) => {
  const [shouldRender, setShouldRender] = useState(isLoading);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    let timeoutId;
    if (isLoading) {
      // Small delay before showing to prevent flickering for instantaneous loads
      timeoutId = setTimeout(() => {
        setShouldRender(true);
        // Force reflow for transition
        requestAnimationFrame(() => {
          setIsVisible(true);
        });
      }, 150); 
    } else {
      setIsVisible(false);
      // Wait for fade out animation before unmounting
      timeoutId = setTimeout(() => {
        setShouldRender(false);
      }, 500); 
    }
    
    return () => clearTimeout(timeoutId);
  }, [isLoading]);

  if (!shouldRender) return null;

  return (
    <div className={`rooms-global-loader ${isVisible ? 'visible' : ''}`}>
      {/* Background ambient glow */}
      <div className="rooms-loader-ambient"></div>
      
      {/* Top light beam */}
      <div className="rooms-loader-beam"></div>

      {/* Main Content Container */}
      <div className="rooms-loader-content">
        <div className="rooms-loader-brand-container">
          <h1 className="rooms-loader-brand">ALSHAYEB</h1>
          <h2 className="rooms-loader-subtitle">ROOM REGISTRATION</h2>
        </div>

        <div className="rooms-loader-indicator-container">
          <div className="rooms-loader-label">LOADING</div>
          <div className="rooms-loader-segments">
            {[...Array(16)].map((_, i) => {
              // Calculate distance from center (0 to 7.5) to vary base brightness
              const distFromCenter = Math.abs(i - 7.5);
              const brightnessMultiplier = 1 - (distFromCenter / 15);
              return (
                <div 
                  key={i} 
                  className="rooms-loader-segment" 
                  style={{ 
                    animationDelay: `${i * 0.08}s`,
                    opacity: 0.2 + (brightnessMultiplier * 0.3)
                  }}
                ></div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default RoomsLoadingScreen;
