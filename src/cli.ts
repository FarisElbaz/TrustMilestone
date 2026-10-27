import { verify } from "./verify";

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = process.argv[index + 1];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

verify(argument("--case"), argument("--submission"))
  .then((decision) => { console.log(decision.decision); })
  .catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
