// Runs before each integration test file's imports: point the app at the test
// database and the test bucket BEFORE src/config/env.ts is loaded (dotenv never
// overrides values that are already set).
import { TEST_DATABASE_URL } from './testDb';
import { TEST_S3 } from './testStorage';

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.NODE_ENV = 'test';
process.env.S3_ENDPOINT = TEST_S3.endpoint;
process.env.S3_REGION = TEST_S3.region;
process.env.S3_BUCKET = TEST_S3.bucket;
process.env.S3_ACCESS_KEY_ID = TEST_S3.accessKeyId;
process.env.S3_SECRET_ACCESS_KEY = TEST_S3.secretAccessKey;
