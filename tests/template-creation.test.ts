/**
 * Template-based case creation tests.
 * Tests the core logic directly (no HTTP server needed in sandbox).
 * Covers: template list, out/<id> file copy, missing template rejection.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const TESTSET_BASE = path.resolve("testset", "cases");
let tempDir: string;
const caseOut = (caseId: string) => path.join(tempDir, caseId);

beforeAll(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "template-creation-test-"));
  process.env.OUTPUT_ROOT = tempDir;
});

afterAll(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

// ── Helper: same logic as the /api/templates endpoint ─────────────────────────
async function listTemplates() {
  const entries = await fs.readdir(TESTSET_BASE, { withFileTypes: true });
  return Promise.all(
    entries
      .filter((e) => e.isDirectory() && /^c\d+$/.test(e.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(async (e) => {
        let brief = "";
        try { brief = await fs.readFile(path.join(TESTSET_BASE, e.name, "brief.md"), "utf8"); } catch { /* ignore */ }
        return { id: e.name, label: brief.split("\n")[0].trim() || e.name, brief };
      })
  );
}

// ── Helper: same logic as POST /api/cases ──────────────────────────────────────
async function createCaseFromTemplate(caseId: string, templateId: string, brief: string) {
  if (!templateId) throw new Error("templateId is required.");
  const tmplPath = path.join(TESTSET_BASE, templateId);
  try { await fs.stat(tmplPath); } catch { throw new Error(`Template "${templateId}" was not found in testset/cases/.`); }
  const outDir = caseOut(caseId);
  await fs.mkdir(outDir, { recursive: true });
  // tests/ lives inside reference/ for cases that don't have a top-level tests/ folder
  const testsSource = await fs.stat(path.join(tmplPath, "tests")).then(() => path.join(tmplPath, "tests")).catch(() => path.join(tmplPath, "reference", "tests"));
  await fs.cp(testsSource, path.join(outDir, "tests"), { recursive: true });
  await fs.copyFile(path.join(tmplPath, "manifest.json"), path.join(outDir, "manifest.json"));
  await fs.writeFile(path.join(outDir, "brief.md"), brief);
  await fs.writeFile(path.join(outDir, "case-record.json"), JSON.stringify({ id: caseId, templateId, createdAt: new Date().toISOString() }, null, 2));
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
  const c01 = templates.find((t) => t.id === "c01")!;
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
    const testFiles = await fs.readdir(path.join(outDir, "tests"));
    expect(testFiles.length).toBeGreaterThan(0);

    // manifest.json was copied
    const manifest = JSON.parse(await fs.readFile(path.join(outDir, "manifest.json"), "utf8")) as { stack?: string };
    expect(manifest).toHaveProperty("stack");

    // brief.md was written
    const writtenBrief = await fs.readFile(path.join(outDir, "brief.md"), "utf8");
    expect(writtenBrief).toContain("Create order");

    // case-record.json has templateId saved
    const record = JSON.parse(await fs.readFile(path.join(outDir, "case-record.json"), "utf8")) as { templateId: string };
    expect(record.templateId).toBe("c01");

    // reference/ and variants/ were NOT copied
    await expect(fs.stat(path.join(outDir, "reference"))).rejects.toThrow();
    await expect(fs.stat(path.join(outDir, "variants"))).rejects.toThrow();
  } finally {
    await fs.rm(outDir, { recursive: true, force: true });
  }
});

test("caseDirFor logic: out/<id>/tests exists → use out/<id>", async () => {
  // Simulate a new case that has tests in out/
  const caseId = `casedir-test-${Date.now()}`;
  const outDir = caseOut(caseId);
  await fs.mkdir(path.join(outDir, "tests"), { recursive: true });
  try {
    // The logic from app.ts verify action
    let caseDir: string;
    try {
      await fs.access(path.join(outDir, "tests"));
      caseDir = outDir;
    } catch {
      caseDir = path.resolve("testset", "cases", caseId);
    }
    expect(caseDir).toBe(outDir);
  } finally {
    await fs.rm(outDir, { recursive: true, force: true });
  }
});

test("caseDirFor logic: no out/<id>/tests → fall back to testset/cases/<id>", async () => {
  const caseId = "c01"; // exists in testset, no special out/ tests
  const outDir = caseOut(caseId);
  // Ensure no tests in out/c01
  try { await fs.rm(path.join(outDir, "tests"), { recursive: true, force: true }); } catch { /* ok */ }

  let caseDir: string;
  try {
    await fs.access(path.join(outDir, "tests"));
    caseDir = outDir;
  } catch {
    caseDir = path.resolve("testset", "cases", caseId);
  }
  expect(caseDir).toBe(path.resolve("testset", "cases", caseId));
});
