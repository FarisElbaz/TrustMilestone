"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const route_1 = require("../src/route");
const outcome = (result, method = "test") => ({ id: "C1", method, result, evidence: "evidence" });
test("releases when all applicable criteria pass", () => expect((0, route_1.route)([outcome("pass"), outcome("pass", "code_review")]).decision).toBe("release"));
test("rejects a decided failure and includes evidence", () => expect((0, route_1.route)([outcome("fail")])).toMatchObject({ decision: "reject", failingCriteria: [{ id: "C1" }] }));
test("escalates unclear and manual outcomes", () => expect((0, route_1.route)([outcome("pass"), outcome("unclear", "code_review")]).decision).toBe("escalate"));
test("reject wins over unclear mixed outcomes", () => expect((0, route_1.route)([outcome("fail"), outcome("unclear")]).decision).toBe("reject"));
