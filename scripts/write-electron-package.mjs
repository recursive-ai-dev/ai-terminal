import { mkdir, writeFile } from "node:fs/promises";

await mkdir("electron-dist", { recursive: true });
await writeFile(
  "electron-dist/package.json",
  JSON.stringify({ type: "commonjs" }, null, 2) + "\n",
  "utf8",
);
