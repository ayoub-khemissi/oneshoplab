import React from "react";
import { AbsoluteFill } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { Intro } from "./scenes/Intro";
import { ImportCatalog } from "./scenes/ImportCatalog";
import { OptimizeReveal } from "./scenes/OptimizeReveal";
import { Cta } from "./scenes/Cta";
import { colors } from "./theme";
import type { Locale } from "./i18n";

export const SCENES = {
  intro: 75,
  import: 165,
  optimize: 285,
  cta: 110,
  transition: 15,
} as const;

export const AD_DURATION =
  SCENES.intro + SCENES.import + SCENES.optimize + SCENES.cta - SCENES.transition * 3; // 590

export type AdProps = {
  locale: Locale;
};

export const Ad: React.FC<AdProps> = ({ locale }) => {
  const t = linearTiming({ durationInFrames: SCENES.transition });
  return (
    <AbsoluteFill style={{ background: colors.ink2 }}>
      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={SCENES.intro}>
          <Intro locale={locale} />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={t} />

        <TransitionSeries.Sequence durationInFrames={SCENES.import}>
          <ImportCatalog locale={locale} />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={t} />

        <TransitionSeries.Sequence durationInFrames={SCENES.optimize}>
          <OptimizeReveal locale={locale} />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={t} />

        <TransitionSeries.Sequence durationInFrames={SCENES.cta}>
          <Cta locale={locale} />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
};
