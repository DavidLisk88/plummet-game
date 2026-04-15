import { Composition } from "remotion";
import { PlummetTikTok } from "./compositions/PlummetTikTok";
import { tiktokCaptions } from "./captions";

const FPS = 30;

export const RemotionRoot = () => {
  return (
    <>
      {/* Main TikTok template — 30s vertical video */}
      <Composition
        id="PlummetTikTok"
        component={PlummetTikTok}
        durationInFrames={FPS * 30}
        fps={FPS}
        width={1080}
        height={1920}
        defaultProps={{
          caption: tiktokCaptions[0],
          gameplayClip: "gameplay-clip.mp4",
          musicTrack: "track.mp3",
          ctaText: "PLUMMET — No Ads. iOS & Android",
        }}
      />

      {/* 60s version for longer previews */}
      <Composition
        id="PlummetTikTok60"
        component={PlummetTikTok}
        durationInFrames={FPS * 60}
        fps={FPS}
        width={1080}
        height={1920}
        defaultProps={{
          caption: tiktokCaptions[0],
          gameplayClip: "gameplay-clip.mp4",
          musicTrack: "track.mp3",
          ctaText: "PLUMMET — No Ads. iOS & Android",
        }}
      />

      {/* Instagram Reel (same format, shorter) */}
      <Composition
        id="PlummetReel"
        component={PlummetTikTok}
        durationInFrames={FPS * 15}
        fps={FPS}
        width={1080}
        height={1920}
        defaultProps={{
          caption: tiktokCaptions[0],
          gameplayClip: "gameplay-clip.mp4",
          musicTrack: "track.mp3",
          ctaText: "PLUMMET — No Ads. iOS & Android",
        }}
      />
    </>
  );
};
