import { judgeCriterion } from "../src/judge";
const callWith = (values: string[]) => { let i = 0; return async () => values[i++]; };
const verdict = (value: string) => JSON.stringify({ verdict: value, reason: value, files: ["src/app.ts"] });
test("decides when all three agree", async () => await expect(judgeCriterion({ id: "C1", criterion: "works" }, "testset/cases/c01/reference", callWith([verdict("pass"), verdict("pass"), verdict("pass")])).then((r) => r.combined)).resolves.toBe("decided"));
test("is unclear when only two agree", async () => await expect(judgeCriterion({ id: "C1", criterion: "works" }, "testset/cases/c01/reference", callWith([verdict("pass"), verdict("pass"), verdict("fail")])).then((r) => r.combined)).resolves.toBe("unclear"));
test("is unclear when all disagree", async () => await expect(judgeCriterion({ id: "C1", criterion: "works" }, "testset/cases/c01/reference", callWith([verdict("pass"), verdict("fail"), verdict("unclear")])).then((r) => r.combined)).resolves.toBe("unclear"));
