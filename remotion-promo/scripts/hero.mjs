// Renders the hero story loops and exports web-ready files to out/hero/:
//   hero-<variant>.mp4 (H.264 + AAC, faststart), 30 fps, plus a poster .webp.
// No WebM: Remotion's bundled VP9 encode fails to decode in Chromium (PIPELINE_ERROR_DECODE).
// The site autoplays them muted; the soundtrack is there for the unmute button and for sharing.
// Run `pnpm hero:audio` first if the timeline changed.
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import timeline from "../src/hero/hero-timeline.json" with { type: "json" };

const run = (cmd) => execSync(cmd, { stdio: "inherit" });
mkdirSync("out/hero", { recursive: true });
// cmd.exe mangles inline JSON, so still props go through a file
writeFileSync("out/hero/still-props.json", JSON.stringify({ withAudio: false }));
const FRAMES_30 = timeline.durationInFrames / 2;
// the "approved" moment: before/after + score jump, for reduced-motion users
const POSTER_FRAME = timeline.story.appFrom + timeline.app.applied + 30;

for (const [id, v] of [["HeroStory-Desktop", "desktop"], ["HeroStory-Mobile", "mobile"]]) {
  const master = `out/hero/${v}-master.mp4`;
  run(`npx remotion render ${id} ${master} --crf=10 --audio-codec=aac --audio-bitrate=320k --concurrency=8`);
  run(`npx remotion ffmpeg -y -v error -i ${master} -r 30 -frames:v ${FRAMES_30} -vf scale=in_range=pc:out_range=tv,format=yuv420p -color_range tv -c:v libx264 -preset slow -crf 26 -c:a aac -b:a 128k -movflags +faststart out/hero/hero-${v}.mp4`);
  run(`npx remotion still ${id} out/hero/${v}-poster.png --frame=${POSTER_FRAME} --props=out/hero/still-props.json`);
  // Remotion's ffmpeg has no libwebp; Pillow does the conversion.
  run(`python -c "from PIL import Image; Image.open('out/hero/${v}-poster.png').save('out/hero/hero-${v}-poster.webp', quality=82)"`);
}
