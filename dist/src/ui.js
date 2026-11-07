"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const env_1 = require("./env");
const ui_server_1 = require("./ui-server");
(0, env_1.loadEnvironment)();
(0, ui_server_1.startUiServer)();
