"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const verify_1 = require("./verify");
function argument(name) {
    const index = process.argv.indexOf(name);
    const value = process.argv[index + 1];
    if (!value)
        throw new Error(`Missing ${name}`);
    return value;
}
(0, verify_1.verify)(argument("--case"), argument("--submission"))
    .then((decision) => { console.log(decision.decision); })
    .catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
