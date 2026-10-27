import { generateCriteria, CriteriaValidationError } from "../src/criteria";
const valid = JSON.stringify({ summary: "x", criteria: [{ id: "C1", criterion: "x", method: "test", status: "ready", source: "x" }], open_questions: [], out_of_scope: [] });
test("accepts valid model output", async () => await expect(generateCriteria("brief", "stack", async () => valid)).resolves.toMatchObject({ summary: "x" }));
test("rejects invalid JSON", async () => await expect(generateCriteria("brief", "stack", async () => "nope")).rejects.toBeInstanceOf(CriteriaValidationError));
test("rejects missing fields", async () => await expect(generateCriteria("brief", "stack", async () => JSON.stringify({ summary: "x" }))).rejects.toBeInstanceOf(CriteriaValidationError));
