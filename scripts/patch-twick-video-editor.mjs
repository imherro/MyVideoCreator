import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const files = [
  "node_modules/@twick/video-editor/dist/index.mjs",
  "node_modules/@twick/video-editor/dist/index.js",
];

for (const relativePath of files) {
  const path = resolve(relativePath);
  let source = readFileSync(path, "utf8");
  const contextPattern = /const \{ changeLog \} = (useTimelineContext|timeline\.useTimelineContext)\(\);/;
  const durationPattern = "if (durationRef.current && time2 >= durationRef.current) {";
  const patchedDuration = "const playbackDuration = totalDuration || durationRef.current;\n    if (playbackDuration && time2 >= playbackDuration) {";

  if (source.includes(patchedDuration)) continue;
  if (!contextPattern.test(source) || !source.includes(durationPattern)) {
    throw new Error(`Unsupported @twick/video-editor build: ${relativePath}`);
  }
  source = source
    .replace(contextPattern, "const { changeLog, totalDuration } = $1();")
    .replace(durationPattern, patchedDuration);
  writeFileSync(path, source);
  console.log(`Patched ${relativePath} to use the full timeline duration.`);
}
