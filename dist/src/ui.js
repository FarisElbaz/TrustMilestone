"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const env_1 = require("./env");
const app_1 = require("./app");
(0, env_1.loadEnvironment)();
const port = Number(process.env.PORT ?? process.env.UI_PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";
(0, app_1.createApp)().listen(port, host, () => console.log(`Delivery verifier web app listening on http://${host}:${port}`));
