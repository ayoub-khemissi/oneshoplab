import React from "react";
import { Composition } from "remotion";
import { Main } from "./Main";
import { TL } from "./motion";
import { HERO_FRAMES, HeroLoop } from "./hero/HeroLoop";
import { HeroStory, STORY_FRAMES } from "./hero/HeroStory";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="Promo-Vertical" component={Main} width={1080} height={1920} fps={TL.fps} durationInFrames={TL.durationInFrames} defaultProps={{ withAudio: true }} />
    <Composition id="Promo-Landscape" component={Main} width={1920} height={1080} fps={TL.fps} durationInFrames={TL.durationInFrames} defaultProps={{ withAudio: true }} />
    <Composition id="Hero-Desktop" component={HeroLoop} width={1600} height={1000} fps={TL.fps} durationInFrames={HERO_FRAMES} defaultProps={{ variant: "desktop" as const }} />
    <Composition id="Hero-Mobile" component={HeroLoop} width={1080} height={1350} fps={TL.fps} durationInFrames={HERO_FRAMES} defaultProps={{ variant: "mobile" as const }} />
    <Composition id="HeroStory-Desktop" component={HeroStory} width={1600} height={1000} fps={TL.fps} durationInFrames={STORY_FRAMES} defaultProps={{ variant: "desktop" as const, withAudio: true }} />
    <Composition id="HeroStory-Mobile" component={HeroStory} width={1080} height={1350} fps={TL.fps} durationInFrames={STORY_FRAMES} defaultProps={{ variant: "mobile" as const, withAudio: true }} />
  </>
);
