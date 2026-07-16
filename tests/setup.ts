import { config } from 'dotenv';

config({ path: '.env.test' });

if (!process.env.DATABASE_URL?.includes('test')) {
  throw new Error(
    `Refusing to run tests against "${process.env.DATABASE_URL}" — the suite truncates tables. ` +
      `Point DATABASE_URL at a database with "test" in its name.`,
  );
}
