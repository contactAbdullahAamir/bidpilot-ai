import { existsSync } from "node:fs";
import path from "node:path";

/** Load the repository-root .env (if present) before anything reads process.env. */
for (const candidate of [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "../../.env")]) {
  if (existsSync(candidate)) {
    try {
      process.loadEnvFile(candidate);
    } catch {
      /* older Node: rely on the real environment */
    }
    break;
  }
}
