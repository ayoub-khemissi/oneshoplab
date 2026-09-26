# OneShopLab — 45 s promo (Remotion)

Motion-design promo, scenario "a merchant's night": 1:47 AM, Sam rewrites product
pages by hand → "There's a better way." → connect the store, audit, AI generation,
approve, bulk → 7:30 AM, orders come in → end card. English, 9:16 first (16:9
composition exists but is the portrait stage scaled into the frame — needs its own
layout pass). Isolated from the Next.js app, own `package.json` (like `remotion-ads`).

Everything is code: Remotion 4 (React 19) for the picture, Python (numpy/scipy) for
the score and sound design (no samples), Kokoro-82M for the voice-over, faster-whisper
to check each take and time the captions word by word.

## Commands

```bash
pnpm install
python -m pip install uv          # once; Python envs are managed by uv (audio/pyproject.toml)

pnpm vo        # Kokoro TTS → audio/cache/vo/*.wav + src/vo.json (word timings)
pnpm audio     # score + SFX + VO mix → public/audio/mix.wav (-14 LUFS, -1 dBTP), out/audio-check.png
pnpm render    # → out/oneshoplab-promo-vertical.mp4 (1080×1920, 60 fps, H.264)
pnpm studio    # live preview

node scripts/stills.mjs 250 1100 1850     # review frames → out/stills/
python -m uv run --project audio audio/check_mix.py   # whisper the final mix (VO intelligible?)
```

## Timing

`src/timeline.json` is the single source of truth (60 fps, 120 BPM → 30 frames per
beat, 120 per bar): scene windows, VO line start frames, and the cues shared by the
visuals and the SFX. Change a timing → re-run `pnpm vo` (if a VO line moved) and
`pnpm audio` before `pnpm render`, or the sound drifts.

Two SFX lists mirror constants in `src/scenes/Grind.tsx` (typing bursts, keycap pops)
— keep them in sync if you edit that scene.

## Design

Tokens 1:1 from `src/app/globals.css` (brand cobalt oklch 250, snow/eclipse, success/
warning/danger), Geist + Geist Mono, lucide icons, the site's mono eyebrows with the
blue dot, score badges, platform chips, BEFORE/AFTER product card. Product photos
from `remotion-ads/public/products` and `public/tour`.

Voice: Kokoro `af_heart` (Apache-2.0 weights). Music: D major, night Bm7–Gmaj7–Dadd9–Asus,
tape-stop on the freeze, drop on D–A–Bm–G, morning G–A, resolves on Dmaj9 for the end card.
