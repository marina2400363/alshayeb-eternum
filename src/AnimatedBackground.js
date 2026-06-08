import React from "react";

const particles = Array.from({ length: 18 }, (_, i) => ({
  id: i,
  left: `${Math.random() * 100}%`,
  animationDelay: `${Math.random() * 6}s`,
  animationDuration: `${5 + Math.random() * 8}s`
}));

function AnimatedBackground() {
  return (
    <div className="animated-bg">
      <div className="stars-layer"></div>
      <div className="stars-layer second"></div>
      <div className="light-beam"></div>

      {particles.map((particle) => (
        <span
          key={particle.id}
          className="particle"
          style={{
            left: particle.left,
            animationDelay: particle.animationDelay,
            animationDuration: particle.animationDuration
          }}git add qr-code-app

          
        ></span>
      ))}
    </div>
  );
}

export default React.memo(AnimatedBackground);
