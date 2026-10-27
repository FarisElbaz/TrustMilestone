import { route } from "../src/route";
const outcome = (result: "pass" | "fail" | "unclear", method: "test" | "code_review" | "manual" = "test") => ({ id: "C1", method, result, evidence: "evidence" });
test("releases when all applicable criteria pass", () => expect(route([outcome("pass"), outcome("pass", "code_review")]).decision).toBe("release"));
test("rejects a decided failure and includes evidence", () => expect(route([outcome("fail")])).toMatchObject({ decision: "reject", failingCriteria: [{ id: "C1" }] }));
test("escalates unclear and manual outcomes", () => expect(route([outcome("pass"), outcome("unclear", "code_review")]).decision).toBe("escalate"));
test("reject wins over unclear mixed outcomes", () => expect(route([outcome("fail"), outcome("unclear")]).decision).toBe("reject"));
