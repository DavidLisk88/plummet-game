import {
  AbsoluteFill,
  Audio,
  Sequence,
  Video,
  useCurrentFrame,
  useVideoConfig,
  staticFile,
  interpolate,
} from "remotion";
import { CaptionOverlay } from "../components/CaptionOverlay";
import { TitleCard } from "../components/TitleCard";
import { LetterRain } from "../components/LetterRain";

export interface PlummetTikTokProps extends Record<string, unknown> {
  caption: string;
  gameplayClip: string;
  musicTrack: string;
  ctaText: string;
}

export const PlummetTikTok = ({
  caption,
  gameplayClip,
  musicTrack,
  ctaText,
}: PlummetTikTokProps) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Global vignette overlay opacity
  const vignetteOpacity = interpolate(frame, [0, fps * 0.5], [0.8, 0.4], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "#0a0a0a" }}>
      {/* ── Layer 1: Gameplay footage ── */}
      <AbsoluteFill>
        <Video
          src={staticFile(gameplayClip)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      </AbsoluteFill>

      {/* ── Layer 2: Vignette overlay for text readability ── */}
      <AbsoluteFill
        style={{
          background: `
            linear-gradient(to bottom,
              rgba(0,0,0,0.7) 0%,
              rgba(0,0,0,0) 25%,
              rgba(0,0,0,0) 75%,
              rgba(0,0,0,0.7) 100%
            )
          `,
          opacity: vignetteOpacity,
        }}
      />

      {/* ── Layer 3: Decorative letter rain (first 5 seconds) ── */}
      <Sequence from={0} durationInFrames={fps * 5}>
        <LetterRain />
      </Sequence>

      {/* ── Layer 4: Hook caption (0s → 4s) ── */}
      <Sequence from={Math.round(fps * 0.3)} durationInFrames={fps * 4}>
        <CaptionOverlay
          text={caption}
          position="top"
          style="tiktok-bold"
        />
      </Sequence>

      {/* ── Layer 5: CTA title card (last 5 seconds) ── */}
      <Sequence from={durationInFrames - fps * 5}>
        <TitleCard text={ctaText} />
      </Sequence>

      {/* ── Audio: Game music ── */}
      <Audio
        src={staticFile(musicTrack)}
        volume={(f: number) =>
          // Fade in over 1s, fade out over last 2s
          interpolate(
            f,
            [0, fps, durationInFrames - fps * 2, durationInFrames],
            [0, 0.7, 0.7, 0],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          )
        }
      />
    </AbsoluteFill>
  );
};
