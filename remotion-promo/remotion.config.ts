import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(95);
// H.264 + yuv420p: plays everywhere (Reels, TikTok, Shorts, iOS).
Config.setCodec("h264");
Config.setPixelFormat("yuv420p");
Config.setCrf(16);
Config.setChromiumOpenGlRenderer("angle");
