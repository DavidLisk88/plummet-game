import { useMemo } from "react";
import {
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  random,
} from "remotion";

/**
 * Decorative falling letters effect — matches PLUMMET's core mechanic.
 * Letters rain down with varying speeds, sizes, and opacity for a
 * subtle atmospheric effect behind the caption.
 */

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LETTER_COUNT = 30;

interface FallingLetter {
  char: string;
  x: number;       // % from left
  speed: number;    // px per frame
  size: number;     // font size
  opacity: number;  // max opacity
  delay: number;    // frame delay before appearing
  rotation: number; // degrees per frame
}

export const LetterRain = () => {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();

  // Generate deterministic random letters (same every render)
  const letters: FallingLetter[] = useMemo(() => {
    return Array.from({ length: LETTER_COUNT }, (_, i) => ({
      char: LETTERS[Math.floor(random(`char-${i}`) * LETTERS.length)],
      x: random(`x-${i}`) * 100,
      speed: 3 + random(`speed-${i}`) * 6,
      size: 28 + random(`size-${i}`) * 48,
      opacity: 0.08 + random(`opacity-${i}`) * 0.2,
      delay: Math.floor(random(`delay-${i}`) * fps * 1.5),
      rotation: -2 + random(`rot-${i}`) * 4,
    }));
  }, [fps]);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      {letters.map((letter, i) => {
        const adjustedFrame = frame - letter.delay;
        if (adjustedFrame < 0) return null;

        const y = adjustedFrame * letter.speed;
        if (y > height + 100) return null;

        const fadeIn = interpolate(adjustedFrame, [0, 10], [0, 1], {
          extrapolateRight: "clamp",
        });

        const rot = adjustedFrame * letter.rotation;

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${letter.x}%`,
              top: y,
              fontSize: letter.size,
              fontFamily: "'Inter', monospace",
              fontWeight: 800,
              color: "#ffffff",
              opacity: letter.opacity * fadeIn,
              transform: `rotate(${rot}deg)`,
              userSelect: "none",
            }}
          >
            {letter.char}
          </div>
        );
      })}
    </div>
  );
};
