// Runs before any app module is imported, so env validation sees test values.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://sandesh:sandesh@localhost:5432/sandesh_test';
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1';
process.env.PUBLIC_URL = 'https://campaigns.example.in';
process.env.APP_SECRET = 'test-secret-that-is-long-enough';
process.env.EMAIL_PROVIDER = 'log';
process.env.SES_SNS_TOPIC_ARN = '';
process.env.APP_URL = 'https://app.example.in';
process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret';
process.env.GOOGLE_REDIRECT_URI = 'https://campaigns.example.in/api/integrations/gmail/callback';
