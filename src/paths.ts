import path from "node:path";

export function outputRoot(): string {
  return path.resolve(process.env.OUTPUT_ROOT ?? "out");
}
