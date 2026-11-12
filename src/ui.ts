import { loadEnvironment } from "./env";
import { createApp } from "./app";

loadEnvironment();
const port = Number(process.env.PORT ?? process.env.UI_PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";
createApp().listen(port, host, () => console.log(`Delivery verifier web app listening on http://${host}:${port}`));
