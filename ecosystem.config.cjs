// PM2 ecosystem for production on the OVH dedicated server.
// Usage on the server, after `pnpm install --prod && pnpm build`:
//   pm2 start ecosystem.config.cjs
//   pm2 save
//   pm2 startup        # generates a systemd service to launch on boot
// Node runtime: the box's system node (/usr/bin/node, nodesource) is shared
// by several other apps and is still 20.x. OneShopLab runs on its own Node 22
// LTS install under /opt/node22 — the web process through `interpreter`, the
// worker through PATH (tsx's shebang is `/usr/bin/env node`). To upgrade,
// drop a new tarball in /opt/node22 and `pnpm deploy`.
const NODE_HOME = '/opt/node22';
const NODE_BIN = `${NODE_HOME}/bin/node`;
const PATH_WITH_NODE = `${NODE_HOME}/bin:${process.env.PATH ?? '/usr/bin:/bin'}`;

module.exports = {
  apps: [
    {
      name: 'oneshoplab-web',
      script: 'node_modules/next/dist/bin/next',
      args: 'start --hostname 127.0.0.1 --port 3030',
      interpreter: NODE_BIN,
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PATH: PATH_WITH_NODE
      },
      max_memory_restart: '512M',
      time: true
    },
    {
      name: 'oneshoplab-worker',
      // pm2 wraps `script` in a CJS `require()` when an interpreter is set,
      // which forces tsx to transform .mts as CJS and reject top-level await.
      // Run tsx as the script with `interpreter: 'none'` so node is invoked
      // with `tsx` as the entry directly — preserves ESM context.
      script: './node_modules/.bin/tsx',
      args: 'src/worker/index.mts',
      interpreter: 'none',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        // Needs tsx ≥ 4.23: with 4.21 on Node 22.23 the worker crashed at
        // boot (named exports of .ts modules came back undefined).
        PATH: PATH_WITH_NODE
      },
      max_memory_restart: '512M',
      time: true,
      autorestart: true,
      restart_delay: 5000
    }
  ]
};
