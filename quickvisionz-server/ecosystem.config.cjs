module.exports = {
  apps: [
    {
      name: 'quickvisionz-server',
      script: 'dist/index.js',
      cwd: '/var/www/quickvisionz-server',
      instances: 1,
      autorestart: true,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3040,
        DATABASE_URL: 'postgresql://quickwms:quickwms@localhost:5432/quickwms',
        REDIS_URL: 'redis://localhost:6379',
        UPLOAD_DIR: '/var/www/quickvisionz-server/uploads',
      },
    },
  ],
};
