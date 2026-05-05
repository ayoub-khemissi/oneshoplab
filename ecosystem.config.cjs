// PM2 ecosystem for production on the OVH dedicated server.
// Usage on the server, after `pnpm install --prod && pnpm build`:
//   pm2 start ecosystem.config.cjs
//   pm2 save
//   pm2 startup        # generates a systemd service to launch on boot
module.exports = {
  apps: [
    {
      name: 'oneshoplab-web',
      script: 'node_modules/next/dist/bin/next',
      args: 'start --hostname 127.0.0.1 --port 3030',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production'
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
        NODE_ENV: 'production'
      },
      max_memory_restart: '512M',
      time: true,
      autorestart: true,
      restart_delay: 5000
    }
  ]
};
