import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The native shell we publish to the stores.
 *
 * It wraps the live site rather than bundling a copy of it: `server.url` points
 * at production, so a deploy reaches the installed app the same minute it
 * reaches the web, with no store review in between. What the shell adds is what
 * the web cannot do on its own — the system bars, and push on iOS.
 *
 * `APP_ENV` picks the origin so a build can be pointed at a staging host
 * without editing this file.
 */
const env = process.env.APP_ENV ?? 'prod';

const origins: Record<string, string> = {
  prod: 'https://oneshoplab.com',
  local: 'http://192.168.1.10:3000'
};

const config: CapacitorConfig = {
  appId: 'com.oneshoplab.app',
  appName: 'OneShopLab',
  // Nothing is bundled: the shell has no local web root of its own. The folder
  // must exist for the CLI, and stays empty on purpose.
  webDir: 'native/www',
  server: {
    url: origins[env] ?? origins.prod,
    // The app is served over TLS in production; a local http origin needs this
    // to be allowed explicitly, hence the flag rather than a hardcoded true.
    cleartext: env === 'local'
  },
  android: {
    // The store bar sits above our own header: the page decides its colour, and
    // the shell keeps the glyphs readable on both.
    backgroundColor: '#ffffff'
  },
  ios: {
    backgroundColor: '#ffffff'
  },
  plugins: {
    PushNotifications: {
      // Badge, sound and banner — the same three the web notification shows.
      presentationOptions: ['badge', 'sound', 'alert']
    },
    StatusBar: {
      // White bar, dark glyphs: the app's light background reaches the top of
      // the screen instead of a brand-coloured band nobody asked for. The dark
      // theme flips it at runtime (see `native/README.md`).
      style: 'LIGHT',
      backgroundColor: '#ffffff',
      overlaysWebView: false
    }
  }
};

export default config;
