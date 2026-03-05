import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3040', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  database: {
    url: process.env.DATABASE_URL || 'postgresql://quickwms:quickwms@localhost:5432/quickwms',
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  uploads: {
    dir: process.env.UPLOAD_DIR || './uploads',
    maxSize: parseInt(process.env.MAX_IMAGE_SIZE || '10485760', 10),
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
  },

  wms: {
    intakez: process.env.QUICKINTAKEZ_URL || 'http://localhost:3001',
    gradez: process.env.QUICKGRADEZ_URL || 'http://localhost:3003',
    listz: process.env.QUICKLISTZ_URL || 'http://localhost:3009',
  },

  auth: {
    piToken: process.env.PI_AUTH_TOKEN || '',
    dashboardToken: process.env.DASHBOARD_TOKEN || '',
    apiToken: process.env.API_TOKEN || '',
  },

  apis: {
    upcItemDb: process.env.UPCITEMDB_API_KEY || '',
    amazon: {
      clientId: process.env.AMAZON_SP_CLIENT_ID || '',
      clientSecret: process.env.AMAZON_SP_CLIENT_SECRET || '',
      refreshToken: process.env.AMAZON_SP_REFRESH_TOKEN || '',
    },
    ebay: {
      appId: process.env.EBAY_APP_ID || '',
      certId: process.env.EBAY_CERT_ID || '',
    },
  },
} as const;
