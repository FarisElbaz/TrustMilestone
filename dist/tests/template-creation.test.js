"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Template-based case creation tests.
 * Tests the core logic directly (no HTTP server needed in sandbox).
 * Covers: template list, out/<id> file copy, missing template rejection.
 */
const promises_1 = __importDefault(require("node:fs/promises"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const TESTSET_BASE = node_path_1.default.resolve("testset", "cases");
let tempDir;
const caseOut = (caseId) => node_path_1.default.join(tempDir, caseId);
beforeAll(async () => {
    tempDir = await promises_1.default.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "template-creation-test-"));
    process.env.OUTPUT_ROOT = tempDir;
});
afterAll(async () => {
    await promises_1.default.rm(tempDir, { recursive: true, force: true });
});
// ── Helper: same logic as the /api/templates endpoint ─────────────────────────
async function listTemplates() {
    const entries = await promises_1.default.readdir(TESTSET_BASE, { withFileTypes: true });
    return Promise.all(entries
        .filter((e) => e.isDirectory() && /^c\d+$/.test(e.name))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(async (e) => {
        let brief = "";
        try {
            brief = await promises_1.default.readFile(node_path_1.default.join(TESTSET_BASE, e.name, "brief.md"), "utf8");
        }
        catch { /* ignore */ }
        return { id: e.name, label: brief.split("\n")[0].trim() || e.name, brief };
    }));
}
// ── Helper: same logic as POST /api/cases ──────────────────────────────────────
async function createCaseFromTemplate(caseId, templateId, brief) {
    if (!templateId)
        throw new Error("templateId is required.");
    const tmplPath = node_path_1.default.join(TESTSET_BASE, templateId);
    try {
        await promises_1.default.stat(tmplPath);
    }
    catch {
        throw new Error(`Template "${templateId}" was not found in testset/cases/.`);
    }
    const outDir = caseOut(caseId);
    await promises_1.default.mkdir(outDir, { recursive: true });
    // tests/ lives inside reference/ for cases that don't have a top-level tests/ folder
    const testsSource = await promises_1.default.stat(node_path_1.default.join(tmplPath, "tests")).then(() => node_path_1.default.join(tmplPath, "tests")).catch(() => node_path_1.default.join(tmplPath, "reference", "tests"));
    await promises_1.default.cp(testsSource, node_path_1.default.join(outDir, "tests"), { recursive: true });
    await promises_1.default.copyFile(node_path_1.default.join(tmplPath, "manifest.json"), node_path_1.default.join(outDir, "manifest.json"));
    await promises_1.default.writeFile(node_path_1.default.join(outDir, "brief.md"), brief);
    await promises_1.default.writeFile(node_path_1.default.join(outDir, "case-record.json"), JSON.stringify({ id: caseId, templateId, createdAt: new Date().toISOString() }, null, 2));
    return { id: caseId, templateId };
}
// ──────────────────────────────────────────────────────────────────────────────
test("listTemplates returns all c01-c08 with label and brief", async () => {
    const templates = await listTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(8);
    const ids = templates.map((t) => t.id);
    for (const id of ["c01", "c02", "c03", "c04", "c05", "c06", "c07", "c08"]) {
        expect(ids).toContain(id);
    }
    const c01 = templates.find((t) => t.id === "c01");
    expect(c01.label).toBeTruthy();
    expect(c01.brief).toMatch(/order|quantity/i);
});
test("creating a case without templateId throws", async () => {
    await expect(createCaseFromTemplate("no-template", "", "some brief")).rejects.toThrow("templateId is required");
});
test("creating a case with unknown templateId throws", async () => {
    await expect(createCaseFromTemplate("bad-template", "c99", "some brief")).rejects.toThrow(/not found/i);
});
test("create case from c01 copies tests/ and manifest.json into out/<id>/", async () => {
    const caseId = `tpl-test-${Date.now()}`;
    const result = await createCaseFromTemplate(caseId, "c01", "Create order, quantity must be positive");
    expect(result.templateId).toBe("c01");
    const outDir = caseOut(caseId);
    try {
        // tests/ folder exists and is non-empty
        const testFiles = await promises_1.default.readdir(node_path_1.default.join(outDir, "tests"));
        expect(testFiles.length).toBeGreaterThan(0);
        // manifest.json was copied
        const manifest = JSON.parse(await promises_1.default.readFile(node_path_1.default.join(outDir, "manifest.json"), "utf8"));
        expect(manifest).toHaveProperty("stack");
        // brief.md was written
        const writtenBrief = await promises_1.default.readFile(node_path_1.default.join(outDir, "brief.md"), "utf8");
        expect(writtenBrief).toContain("Create order");
        // case-record.json has templateId saved
        const record = JSON.parse(await promises_1.default.readFile(node_path_1.default.join(outDir, "case-record.json"), "utf8"));
        expect(record.templateId).toBe("c01");
        // reference/ and variants/ were NOT copied
        await expect(promises_1.default.stat(node_path_1.default.join(outDir, "reference"))).rejects.toThrow();
        await expect(promises_1.default.stat(node_path_1.default.join(outDir, "variants"))).rejects.toThrow();
    }
    finally {
        await promises_1.default.rm(outDir, { recursive: true, force: true });
    }
});
test("caseDirFor logic: out/<id>/tests exists → use out/<id>", async () => {
    // Simulate a new case that has tests in out/
    const caseId = `casedir-test-${Date.now()}`;
    const outDir = caseOut(caseId);
    await promises_1.default.mkdir(node_path_1.default.join(outDir, "tests"), { recursive: true });
    try {
        // The logic from app.ts verify action
        let caseDir;
        try {
            await promises_1.default.access(node_path_1.default.join(outDir, "tests"));
            caseDir = outDir;
        }
        catch {
            caseDir = node_path_1.default.resolve("testset", "cases", caseId);
        }
        expect(caseDir).toBe(outDir);
    }
    finally {
        await promises_1.default.rm(outDir, { recursive: true, force: true });
    }
});
test("caseDirFor logic: no out/<id>/tests → fall back to testset/cases/<id>", async () => {
    const caseId = "c01"; // exists in testset, no special out/ tests
    const outDir = caseOut(caseId);
    // Ensure no tests in out/c01
    try {
        await promises_1.default.rm(node_path_1.default.join(outDir, "tests"), { recursive: true, force: true });
    }
    catch { /* ok */ }
    let caseDir;
    try {
        await promises_1.default.access(node_path_1.default.join(outDir, "tests"));
        caseDir = outDir;
    }
    catch {
        caseDir = node_path_1.default.resolve("testset", "cases", caseId);
    }
    expect(caseDir).toBe(node_path_1.default.resolve("testset", "cases", caseId));
});
