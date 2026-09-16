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
  const rulerPattern = 'transform: "translateX(-50%)",\n                      color: "rgba(255,255,255,0.7)",';
  const patchedRuler = 'transform: t2 >= duration - epsilon ? "translateX(-100%)" : "translateX(-50%)",\n                      color: "rgba(255,255,255,0.7)",';
  let changed = false;

  if (!source.includes(patchedDuration)) {
    if (!contextPattern.test(source) || !source.includes(durationPattern)) {
      throw new Error(`Unsupported playback build: ${relativePath}`);
    }
    source = source
      .replace(contextPattern, "const { changeLog, totalDuration } = $1();")
      .replace(durationPattern, patchedDuration);
    changed = true;
  }
  if (!source.includes(patchedRuler)) {
    if (!source.includes(rulerPattern)) throw new Error(`Unsupported ruler build: ${relativePath}`);
    source = source.replace(rulerPattern, patchedRuler);
    changed = true;
  }
  if (changed) {
    writeFileSync(path, source);
    console.log(`Patched ${relativePath} playback and end-of-timeline label.`);
  }
}

const timelineFiles = [
  "node_modules/@twick/timeline/dist/index.mjs",
  "node_modules/@twick/timeline/dist/index.js",
];

for (const relativePath of timelineFiles) {
  const path = resolve(relativePath);
  let source = readFileSync(path, "utf8");
  const metadataPattern = "await element.updateVideoMeta();";
  const patchedMetadata = "if (!(Number(element.getMediaDuration()) > 0)) await element.updateVideoMeta();";

  if (source.includes(patchedMetadata)) continue;
  if (!source.includes(metadataPattern)) {
    throw new Error(`Unsupported @twick/timeline build: ${relativePath}`);
  }
  source = source.replace(metadataPattern, patchedMetadata);
  writeFileSync(path, source);
  console.log(`Patched ${relativePath} to split known media without reloading metadata.`);
}
