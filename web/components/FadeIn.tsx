"use client";
import { useEffect, useRef, useState, CSSProperties } from "react";

interface FadeInProps {
  children: React.ReactNode;
  delay?: number;
  direction?: "up" | "left" | "right" | "none";
  className?: string;
  style?: CSSProperties;
}

export default function FadeIn({
  children,
  delay = 0,
  direction = "up",
  className,
  style,
}: FadeInProps) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const getTransform = () => {
    if (visible) return "none";
    if (direction === "up") return "translateY(20px)";
    if (direction === "left") return "translateX(-16px)";
    if (direction === "right") return "translateX(16px)";
    return "none";
  };

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: getTransform(),
        transition: `opacity 0.5s ${delay}s ease, transform 0.5s ${delay}s ease`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
