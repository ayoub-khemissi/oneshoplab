import React from "react";
import { AbsoluteFill, Audio, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Background } from "./components/Background";
import { Captions } from "./components/Captions";
import { Grain } from "./components/Ui";
import { CUE, S, prog } from "./motion";
import { Night } from "./scenes/Night";
import { Grind } from "./scenes/Grind";
import { Pause } from "./scenes/Pause";
import { Connect } from "./scenes/Connect";
import { Audit } from "./scenes/Audit";
import { Generate } from "./scenes/Generate";
import { Morning } from "./scenes/Morning";
import { Cta } from "./scenes/Cta";

const STAGE_W = 1080;
const STAGE_H = 1920;

export type MainProps = { withAudio: boolean };

/**
 * Scenes are laid out on a 1080×1920 stage. In 16:9 the stage is scaled to the
 * frame height and centred; the Background stays full-bleed.
 */
export const Main: React.FC<MainProps> = ({ withAudio }) => {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const scale = height / STAGE_H;
  const stageX = (width - STAGE_W * scale) / 2;
  const between = (a: number, b: number) => f >= a && f < b;
  const grain = f < CUE.bloom ? 0.22 : between(S.morning.from, S.morning.to) ? 0.14 : 0.08;

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Background f={f} stageScale={scale} stageX={stageX} />
      <div style={{ position: "absolute", left: stageX, top: 0, width: STAGE_W, height: STAGE_H, transform: `scale(${scale})`, transformOrigin: "top left" }}>
        {between(0, S.night.to + 30) ? <Night f={f} /> : null}
        {between(S.grind.from - 30, CUE.dotCollapse + 10) ? <Grind f={f} /> : null}
        {between(CUE.dotCollapse - 10, CUE.bloom + 20) ? <Pause f={f} /> : null}
        {between(S.connect.from - 4, S.connect.to + 10) ? <Connect f={f} /> : null}
        {between(S.audit.from - 10, S.generate.from + 10) ? <Audit f={f} /> : null}
        {between(S.generate.from - 22, S.generate.to + 10) ? <Generate f={f} /> : null}
        {between(S.morning.from - 12, S.morning.to + 16) ? <Morning f={f} /> : null}
        {f >= S.cta.from - 18 ? <Cta f={f} /> : null}
        <Captions f={f} />
      </div>
      <Grain f={f} opacity={grain * (1 - prog(f, CUE.bloom, CUE.bloom + 30) * 0)} />
      {withAudio ? <Audio src={staticFile("audio/mix.wav")} /> : null}
    </AbsoluteFill>
  );
};
