// Runs before each integration test file's imports: point the app at the test
// database BEFORE src/config/env.ts is loaded (dotenv never overrides values
// that are already set).
import { TEST_DATABASE_URL } from './testDb';

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.NODE_ENV = 'test';
