import type { CSSProperties } from "react";
import {
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";

interface CaptionOverlayProps {
  text: string;
  position?: "top" | "center" | "bottom";
  style?: "tiktok-bold" | "minimal" | "subtitle";
}

export const CaptionOverlay = ({
  text,
  position = "top",
  style = "tiktok-bold",
}: CaptionOverlayProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Split text into words for staggered word-by-word reveal
  const words = text.split(" ");

  const positionStyles: Record<string, CSSProperties> = {
    top: { top: 180, left: 60, right: 60 },
    center: { top: "50%", left: 60, right: 60, transform: "translateY(-50%)" },
    bottom: { bottom: 300, left: 60, right: 60 },
  };

  const textStyles: Record<string, CSSProperties> = {
    "tiktok-bold": {
      fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
      fontSize: 58,
      fontWeight: 900,
      color: "#ffffff",
      textShadow: "0 4px 20px rgba(0,0,0,0.8), 0 2px 4px rgba(0,0,0,0.9)",
      lineHeight: 1.25,
      textAlign: "center",
      letterSpacing: "-0.02em",
    },
    minimal: {
      fontFamily: "'SF Pro Display', 'Inter', sans-serif",
      fontSize: 44,
      fontWeight: 600,
      color: "#ffffff",
      textShadow: "0 2px 12px rgba(0,0,0,0.6)",
      lineHeight: 1.3,
      textAlign: "center",
    },
    subtitle: {
      fontFamily: "'Inter', sans-serif",
      fontSize: 36,
      fontWeight: 500,
      color: "#ffffff",
      background: "rgba(0,0,0,0.6)",
      padding: "12px 24px",
      borderRadius: 12,
      textAlign: "center",
      lineHeight: 1.4,
    },
  };

  // Exit fade
  const exitFade = interpolate(
    frame,
    [fps * 3, fps * 3.8],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <div
      style={{
        position: "absolute",
        ...positionStyles[position],
        ...textStyles[style],
        opacity: exitFade,
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        gap: "0 14px",
      }}
    >
      {words.map((word, i) => {
        // Each word springs in with a stagger
        const delay = i * 3; // 3-frame stagger between words
        const wordSpring = spring({
          frame: frame - delay,
          fps,
          config: { damping: 15, stiffness: 200, mass: 0.8 },
        });

        const translateY = interpolate(wordSpring, [0, 1], [30, 0]);
        const opacity = interpolate(wordSpring, [0, 1], [0, 1]);

        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              transform: `translateY(${translateY}px)`,
              opacity,
            }}
          >
            {word}
          </span>
        );
      })}
    </div>
  );
};
