"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const judge_1 = require("../src/judge");
const config_1 = require("../src/config");
const callWith = (values) => { let i = 0; return async () => values[i++]; };
const verdict = (value) => JSON.stringify({ verdict: value, reason: value, files: ["src/app.ts"] });
test("a malformed judge answer counts as unclear instead of crashing verification", async () => {
    const result = await (0, judge_1.judgeCriterion)({ id: "C1", criterion: "works" }, "testset/cases/c01/reference", callWith([verdict("pass"), "not json", JSON.stringify({ answer: "yes" })]));
    expect(result.verdicts.map((v) => v.verdict)).toEqual(["pass", "unclear", "unclear"]);
    expect(result.combined).toBe("unclear");
    expect(result.result).toBe("unclear");
});
test("a judge answer wrapped in an array is still read", async () => {
    const wrapped = JSON.stringify([{ verdict: "pass", reason: "ok", files: [] }]);
    const result = await (0, judge_1.judgeCriterion)({ id: "C1", criterion: "works" }, "testset/cases/c01/reference", callWith([wrapped, wrapped, wrapped]));
    expect(result).toMatchObject({ combined: "decided", result: "pass" });
});
test("model fallback moves to the next model on 503 and retries the chain once", async () => {
    const tried = [];
    const answer = await (0, config_1.withModelFallback)(["main", "backup"], async (model) => {
        tried.push(model);
        if (tried.length < 3)
            throw new Error("Gemini request failed with HTTP 503");
        return `answered by ${model}`;
    }, 2, 0);
    expect(tried).toEqual(["main", "backup", "main"]);
    expect(answer).toBe("answered by main");
});
test("model fallback does not retry errors that are not availability problems", async () => {
    const tried = [];
    await expect((0, config_1.withModelFallback)(["main", "backup"], async (model) => { tried.push(model); throw new Error("Gemini request failed with HTTP 400"); }, 2, 0)).rejects.toThrow("HTTP 400");
    expect(tried).toEqual(["main"]);
});
