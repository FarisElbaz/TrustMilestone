import fs from "node:fs";
import path from "node:path";

let loaded = false;

function parseLine(line: string): [string, string] | undefined {
  const match = line.replace(/^\uFEFF/, "").match(/^\s*([\w.-]+)\s*=\s*(.*?)\s*$/);
  if (!match) return undefined;
  const value = match[2].replace(/^(['"])(.*)\1$/, "$2").trim();
  return [match[1], value];
}

export function loadEnvironment(): void {
  if (loaded) return;
  loaded = true;
  if (process.env.NODE_ENV === "test") return;
  const candidates = [
    path.resolve(".env"),
    path.resolve("trustmilestone", "backend", ".env"),
    path.resolve(__dirname, "..", "trustmilestone", "backend", ".env")
  ];
  for (const filename of candidates) {
    if (!fs.existsSync(filename)) continue;
    for (const line of fs.readFileSync(filename, "utf8").split(/\r?\n/)) {
      const entry = parseLine(line);
      if (entry && !process.env[entry[0]]) process.env[entry[0]] = entry[1];
    }
    break;
  }
  const aliases: Record<string, string> = {
    BUYER_EMAIL: "PAYPAL_BUYER_EMAIL",
    CONTRACTOR_EMAIL: "PAYPAL_CONTRACTOR_EMAIL",
    BUSINESS_EMAIL: "PAYPAL_BUSINESS_EMAIL",
    PAYPALCURRENCY: "PAYPAL_CURRENCY"
  };
  for (const [source, target] of Object.entries(aliases)) {
    if (!process.env[target] && process.env[source]) process.env[target] = process.env[source];
  }
}
