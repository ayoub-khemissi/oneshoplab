import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
// H.264 + yuv420p so the file plays everywhere (Facebook Ads Manager, mobile, PC).
Config.setCodec("h264");
Config.setPixelFormat("yuv420p");
// Crisp UI text — render at full quality.
Config.setChromiumOpenGlRenderer("angle");
Config.overrideWebpackConfig((c) => c);
