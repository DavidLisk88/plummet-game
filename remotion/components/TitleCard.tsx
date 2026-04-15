import {
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";

interface TitleCardProps {
  text: string;
}

export const TitleCard = ({ text }: TitleCardProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Spring in from bottom
  const entrance = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 120, mass: 1.2 },
  });

  const translateY = interpolate(entrance, [0, 1], [120, 0]);
  const opacity = interpolate(entrance, [0, 1], [0, 1]);
  const scale = interpolate(entrance, [0, 1], [0.85, 1]);

  // Subtle glow pulse
  const glowPulse = interpolate(
    frame,
    [0, fps * 2, fps * 4],
    [0.4, 0.8, 0.4],
    { extrapolateRight: "extend" }
  );

  return (
    <div
      style={{
        position: "absolute",
        bottom: 200,
        left: 40,
        right: 40,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        transform: `translateY(${translateY}px) scale(${scale})`,
        opacity,
      }}
    >
      {/* Glowing pill background */}
      <div
        style={{
          background: "rgba(0,0,0,0.75)",
          backdropFilter: "blur(20px)",
          borderRadius: 28,
          padding: "32px 48px",
          border: "1.5px solid rgba(255,255,255,0.15)",
          boxShadow: `0 0 ${40 * glowPulse}px rgba(100,140,255,${glowPulse * 0.3})`,
        }}
      >
        <div
          style={{
            fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
            fontSize: 46,
            fontWeight: 800,
            color: "#ffffff",
            textAlign: "center",
            letterSpacing: "-0.01em",
            lineHeight: 1.3,
          }}
        >
          {text}
        </div>
      </div>

      {/* Subtle "Download now" subtext */}
      <div
        style={{
          marginTop: 20,
          fontFamily: "'Inter', sans-serif",
          fontSize: 28,
          fontWeight: 500,
          color: "rgba(255,255,255,0.6)",
          textAlign: "center",
        }}
      >
        Download now — Link in bio
      </div>
    </div>
  );
};
