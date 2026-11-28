import 'dotenv/config';

process.env.NODE_ENV = 'test';
if (!process.env.TEST_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL environment variable is required to run tests. Please configure it in your test environment or .env file.');
}
