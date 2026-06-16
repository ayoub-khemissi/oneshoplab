import React from "react";
import { Composition } from "remotion";
import { Ad, AD_DURATION } from "./Ad";
import { CarouselCard } from "./carousel/CarouselCard";
import { LOCALES } from "./i18n";

const FPS = 30;

const FORMATS = [
  { id: "Square", width: 1080, height: 1080 },
  { id: "Vertical", width: 1080, height: 1920 },
] as const;

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {LOCALES.flatMap((locale) =>
        FORMATS.map((f) => (
          <Composition
            key={`${locale}-${f.id}`}
            id={`Ad-${locale.toUpperCase()}-${f.id}`}
            component={Ad}
            durationInFrames={AD_DURATION}
            fps={FPS}
            width={f.width}
            height={f.height}
            defaultProps={{ locale }}
          />
        )),
      )}

      {/* Carousel cards — static 1080×1080 stills (rendered via tools/render-carousel.mjs) */}
      <Composition
        id="Card"
        component={CarouselCard}
        durationInFrames={1}
        fps={FPS}
        width={1080}
        height={1080}
        defaultProps={{ locale: "fr" as const, card: 1 }}
      />
    </>
  );
};
