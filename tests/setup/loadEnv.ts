import "dotenv/config";

if (!process.env.TEST_DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL must be set to run tests (see .env) — point it at a dedicated Neon branch");
}
