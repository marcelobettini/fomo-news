import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Lee un fixture XML desde tests/fixtures relativo a la raíz del proyecto (cwd de `npm test`). */
export function readFixture(name: string): string {
  return readFileSync(join(process.cwd(), "tests", "fixtures", name), "utf-8");
}
