// PM2 ecosystem for production on the OVH dedicated server.
// Usage on the server, after `pnpm install --prod && pnpm build`:
//   pm2 start ecosystem.config.cjs
//   pm2 save
//   pm2 startup        # generates a systemd service to launch on boot
module.exports = {
  apps: [
    {
      name: 'oneshoplab-web',
      script: '.next/standalone/server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOSTNAME: '127.0.0.1' // bind locally; nginx fronts it
      },
      max_memory_restart: '512M',
      time: true
    },
    {
      name: 'oneshoplab-worker',
      script: './node_modules/tsx/dist/cli.mjs',
      args: 'src/worker/index.ts',
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
