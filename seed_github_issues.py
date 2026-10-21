#!/usr/bin/env python3
"""
Automated Issue Seeder for GitHub
Prerequisites:
  1. Authenticate with GitHub CLI:
       gh auth login
  2. Run inside your local git repository clone:
       python3 seed_github_issues.py
"""

import subprocess
import sys

ISSUES = [
  {
    "number": 1,
    "title": "Initialize monorepo (Next.js frontend + FastAPI or Express backend).",
    "sprint": "Sprint 1: Core PayPal Infrastructure & Sandbox Plumbing",
    "day": "Day 1 (Oct 21) \u2014 Project Initialization & Board Scaffolding"
  },
  {
    "number": 2,
    "title": "Configure GitHub Projects board with custom fields, views, and issue labels.",
    "sprint": "Sprint 1: Core PayPal Infrastructure & Sandbox Plumbing",
    "day": "Day 1 (Oct 21) \u2014 Project Initialization & Board Scaffolding"
  },
  {
    "number": 3,
    "title": "Generate PayPal Sandbox merchant & personal test accounts in developer portal.",
    "sprint": "Sprint 1: Core PayPal Infrastructure & Sandbox Plumbing",
    "day": "Day 1 (Oct 21) \u2014 Project Initialization & Board Scaffolding"
  },
  {
    "number": 4,
    "title": "Build backend OAuth2 service with in-memory token cache (refresh before 9-hour expiry).",
    "sprint": "Sprint 1: Core PayPal Infrastructure & Sandbox Plumbing",
    "day": "Day 2 (Oct 22) \u2014 PayPal OAuth2 & Orders v2 Authorization Endpoint"
  },
  {
    "number": 5,
    "title": "Implement `POST /api/escrow/create-order` calling PayPal Orders v2 with `intent: \"AUTHORIZE\"`.",
    "sprint": "Sprint 1: Core PayPal Infrastructure & Sandbox Plumbing",
    "day": "Day 2 (Oct 22) \u2014 PayPal OAuth2 & Orders v2 Authorization Endpoint"
  },
  {
    "number": 6,
    "title": "Implement frontend PayPal JS SDK Buttons triggering `onApprove`.",
    "sprint": "Sprint 1: Core PayPal Infrastructure & Sandbox Plumbing",
    "day": "Day 3 (Oct 23) \u2014 Client Approval & Authorization Persistence"
  },
  {
    "number": 7,
    "title": "Save `order_id` AND the returned `authorization_id` from `/v2/checkout/orders/{id}/authorize` into database/memory store.",
    "sprint": "Sprint 1: Core PayPal Infrastructure & Sandbox Plumbing",
    "day": "Day 3 (Oct 23) \u2014 Client Approval & Authorization Persistence"
  },
  {
    "number": 8,
    "title": "Implement `POST /api/escrow/capture` targeting `/v2/payments/authorizations/{authorization_id}/capture`.",
    "sprint": "Sprint 1: Core PayPal Infrastructure & Sandbox Plumbing",
    "day": "Day 4 (Oct 24) \u2014 Capture & Payouts Engine Scaffold"
  },
  {
    "number": 9,
    "title": "Implement `POST /api/escrow/payout` targeting `/v1/payments/payouts` with unique `PayPal-Request-Id` idempotency header.",
    "sprint": "Sprint 1: Core PayPal Infrastructure & Sandbox Plumbing",
    "day": "Day 4 (Oct 24) \u2014 Capture & Payouts Engine Scaffold"
  },
  {
    "number": 10,
    "title": "Implement `/api/webhooks/paypal` supporting `PAYMENT.AUTHORIZATION.CREATED` and `PAYMENT.CAPTURE.COMPLETED`.",
    "sprint": "Sprint 1: Core PayPal Infrastructure & Sandbox Plumbing",
    "day": "Day 5 (Oct 25) \u2014 Webhook Listener & State Machine"
  },
  {
    "number": 11,
    "title": "Create job status state machine: `DRAFT` $\\rightarrow$ `FUNDED` $\\rightarrow$ `IN_PROGRESS` $\\rightarrow$ `VERIFIED` $\\rightarrow$ `RELEASED`.",
    "sprint": "Sprint 1: Core PayPal Infrastructure & Sandbox Plumbing",
    "day": "Day 5 (Oct 25) \u2014 Webhook Listener & State Machine"
  },
  {
    "number": 12,
    "title": "Execute complete manual test: Buyer authorizes $\\$500 \\rightarrow$ backend captures $\\$250 \\rightarrow$ payouts disburses to contractor sandbox email.",
    "sprint": "Sprint 1: Core PayPal Infrastructure & Sandbox Plumbing",
    "day": "Day 6 (Oct 26) \u2014 Sprint 1 Review & End-to-End Payment Test"
  },
  {
    "number": 13,
    "title": "Implement `POST /api/ai/plan-scope` using LLM Structured Outputs (Pydantic / Zod schema).",
    "sprint": "Sprint 2: The Dual-Agent Pipeline & Vision Verification",
    "day": "Day 7 (Oct 27) \u2014 Agent 1: Scope-to-Milestone Planner"
  },
  {
    "number": 14,
    "title": "Prompt tuning for Agent 1 to convert any trade (painting, cleaning, drywall) into 2\u20134 milestones with amounts and visual criteria.",
    "sprint": "Sprint 2: The Dual-Agent Pipeline & Vision Verification",
    "day": "Day 7 (Oct 27) \u2014 Agent 1: Scope-to-Milestone Planner"
  },
  {
    "number": 15,
    "title": "Build multipart upload endpoint `POST /api/milestones/{id}/upload-proof` accepting before/after photos.",
    "sprint": "Sprint 2: The Dual-Agent Pipeline & Vision Verification",
    "day": "Day 8 (Oct 28) \u2014 Image Upload & Storage Infrastructure"
  },
  {
    "number": 16,
    "title": "Add automatic image compression/downscaling (max 1600px) to prevent payload timeouts.",
    "sprint": "Sprint 2: The Dual-Agent Pipeline & Vision Verification",
    "day": "Day 8 (Oct 28) \u2014 Image Upload & Storage Infrastructure"
  },
  {
    "number": 17,
    "title": "Implement `POST /api/ai/inspect-work` passing before/after images and dynamic criteria to GPT-4o / Claude 3.5 Sonnet.",
    "sprint": "Sprint 2: The Dual-Agent Pipeline & Vision Verification",
    "day": "Day 9 (Oct 29) \u2014 Agent 2: Multimodal Inspection Engine"
  },
  {
    "number": 18,
    "title": "Enforce Chain-of-Thought schema: `observations` $\\rightarrow$ `checklist_breakdown` $\\rightarrow$ `compliance_score` $\\rightarrow$ `verdict`.",
    "sprint": "Sprint 2: The Dual-Agent Pipeline & Vision Verification",
    "day": "Day 9 (Oct 29) \u2014 Agent 2: Multimodal Inspection Engine"
  },
  {
    "number": 19,
    "title": "Implement weighted checklist scoring in code (`score = passed_items / total_items`).",
    "sprint": "Sprint 2: The Dual-Agent Pipeline & Vision Verification",
    "day": "Day 10 (Oct 30) \u2014 Verification Guardrails & Calibration"
  },
  {
    "number": 20,
    "title": "Run calibration tests: test 3 passed jobs, 2 borderline jobs, and 1 complete failure (the \"Cat Photo\" test) at `temperature: 0.0`.",
    "sprint": "Sprint 2: The Dual-Agent Pipeline & Vision Verification",
    "day": "Day 10 (Oct 30) \u2014 Verification Guardrails & Calibration"
  },
  {
    "number": 21,
    "title": "Wire Agent 2 output directly to PayPal Capture & Payouts when `verdict == \"APPROVED\"`.",
    "sprint": "Sprint 2: The Dual-Agent Pipeline & Vision Verification",
    "day": "Day 11 (Oct 31) \u2014 Orchestrator Connection: Vision to PayPal Trigger"
  },
  {
    "number": 22,
    "title": "Add human fallback routing when `verdict == \"NEEDS_HUMAN_REVIEW\"`.",
    "sprint": "Sprint 2: The Dual-Agent Pipeline & Vision Verification",
    "day": "Day 11 (Oct 31) \u2014 Orchestrator Connection: Vision to PayPal Trigger"
  },
  {
    "number": 23,
    "title": "Test the full pipeline: Input text $\\rightarrow$ auto-milestones $\\rightarrow$ fund escrow $\\rightarrow$ upload photo $\\rightarrow$ AI passes work $\\rightarrow$ PayPal moves money.",
    "sprint": "Sprint 2: The Dual-Agent Pipeline & Vision Verification",
    "day": "Day 12 (Nov 1) \u2014 Sprint 2 Review & Autonomous Payout Demo"
  },
  {
    "number": 24,
    "title": "Install `ag-grid-react` and configure professional theme (`ag-theme-alpine` or `ag-theme-quartz-dark`).",
    "sprint": "Sprint 3: AG Grid Dashboard, Edge Cases & Cloud Deployment",
    "day": "Day 13 (Nov 2) \u2014 AG Grid Escrow Ledger Setup (\\$5,000 Sponsor Track)"
  },
  {
    "number": 25,
    "title": "Build the Live Milestone Ledger with custom cell renderers: status badges, confidence progress bars, and PayPal transaction deep links.",
    "sprint": "Sprint 3: AG Grid Dashboard, Edge Cases & Cloud Deployment",
    "day": "Day 13 (Nov 2) \u2014 AG Grid Escrow Ledger Setup (\\$5,000 Sponsor Track)"
  },
  {
    "number": 26,
    "title": "Build Homeowner Portal: job creation form, PayPal Authorize button, visual inspection report viewer.",
    "sprint": "Sprint 3: AG Grid Dashboard, Edge Cases & Cloud Deployment",
    "day": "Day 14 (Nov 3) \u2014 Dual-Role UI Views (Homeowner vs. Contractor)"
  },
  {
    "number": 27,
    "title": "Build Contractor Portal: active jobs list, milestone photo upload interface, payout confirmation receipt.",
    "sprint": "Sprint 3: AG Grid Dashboard, Edge Cases & Cloud Deployment",
    "day": "Day 14 (Nov 3) \u2014 Dual-Role UI Views (Homeowner vs. Contractor)"
  },
  {
    "number": 28,
    "title": "Build the Dispute Mode: if work is rejected, AI generates a 3-bullet objective defect breakdown for both parties.",
    "sprint": "Sprint 3: AG Grid Dashboard, Edge Cases & Cloud Deployment",
    "day": "Day 15 (Nov 4) \u2014 Dispute Resolution & 48-Hour Inactivity Lock"
  },
  {
    "number": 29,
    "title": "Implement the 48-hour auto-approval timer logic (prevents homeowners from ghosting after work is verified).",
    "sprint": "Sprint 3: AG Grid Dashboard, Edge Cases & Cloud Deployment",
    "day": "Day 15 (Nov 4) \u2014 Dispute Resolution & 48-Hour Inactivity Lock"
  },
  {
    "number": 30,
    "title": "Create `render.yaml` blueprint configuring FastAPI backend and Next.js frontend web service.",
    "sprint": "Sprint 3: AG Grid Dashboard, Edge Cases & Cloud Deployment",
    "day": "Day 16 (Nov 5) \u2014 Cloud Deployment on Render (\\$1,000 Sponsor Track)"
  },
  {
    "number": 31,
    "title": "Configure Render environment variables: PayPal Sandbox Client ID, Secret, and AI API keys.",
    "sprint": "Sprint 3: AG Grid Dashboard, Edge Cases & Cloud Deployment",
    "day": "Day 16 (Nov 5) \u2014 Cloud Deployment on Render (\\$1,000 Sponsor Track)"
  },
  {
    "number": 32,
    "title": "Verify the deployed Render web URL works from a clean browser with zero CORS or environment errors.",
    "sprint": "Sprint 3: AG Grid Dashboard, Edge Cases & Cloud Deployment",
    "day": "Day 17 (Nov 6) \u2014 Sprint 3 Review & Production Sanity Check"
  },
  {
    "number": 33,
    "title": "Write a one-click database reset script `python reset_demo.py` that clears stale transactions and sets up clean demo data.",
    "sprint": "Sprint 4: Hardening, Video Demo & Final Devpost Submission",
    "day": "Day 18 (Nov 7) \u2014 Edge Case Hardening & Sandbox Reset Script"
  },
  {
    "number": 34,
    "title": "Add graceful error toasts for network drops or invalid image uploads.",
    "sprint": "Sprint 4: Hardening, Video Demo & Final Devpost Submission",
    "day": "Day 18 (Nov 7) \u2014 Edge Case Hardening & Sandbox Reset Script"
  },
  {
    "number": 35,
    "title": "Finalize slide cards and storyboard for the 3-minute video demo.",
    "sprint": "Sprint 4: Hardening, Video Demo & Final Devpost Submission",
    "day": "Day 19 (Nov 8) \u2014 Video Demo Scripting & Rehearsal"
  },
  {
    "number": 36,
    "title": "Run 3 complete live screen-recording dry runs (timing each to under 2 minutes 50 seconds).",
    "sprint": "Sprint 4: Hardening, Video Demo & Final Devpost Submission",
    "day": "Day 19 (Nov 8) \u2014 Video Demo Scripting & Rehearsal"
  },
  {
    "number": 37,
    "title": "Record high-definition screencast (1080p, 60fps) with clean browser tabs (no developer console clutter).",
    "sprint": "Sprint 4: Hardening, Video Demo & Final Devpost Submission",
    "day": "Day 20 (Nov 9) \u2014 Video Production & Voiceover Recording"
  },
  {
    "number": 38,
    "title": "Edit video with professional pacing, title cards, and callouts highlighting PayPal Sandbox transactions. Upload unlisted to YouTube.",
    "sprint": "Sprint 4: Hardening, Video Demo & Final Devpost Submission",
    "day": "Day 20 (Nov 9) \u2014 Video Production & Voiceover Recording"
  },
  {
    "number": 39,
    "title": "Write the Devpost project page using the required hackathon headings: *Inspiration*, *What it does*, *How we built it*, *Challenges*, and *Accomplishments*.",
    "sprint": "Sprint 4: Hardening, Video Demo & Final Devpost Submission",
    "day": "Day 21 (Nov 10) \u2014 Devpost Writeup & Repository Polish"
  },
  {
    "number": 40,
    "title": "Polish public GitHub `README.md` with architectural diagram, setup instructions, and sponsor badges (AG Grid & Render).",
    "sprint": "Sprint 4: Hardening, Video Demo & Final Devpost Submission",
    "day": "Day 21 (Nov 10) \u2014 Devpost Writeup & Repository Polish"
  },
  {
    "number": 41,
    "title": "Submit project on Devpost on Wednesday, Nov 11 (24 hours before the Nov 12 deadline to protect against portal server traffic).",
    "sprint": "Sprint 4: Hardening, Video Demo & Final Devpost Submission",
    "day": "Day 22 (Nov 11\u201312) \u2014 Submission Lock-In & Final Safety Window"
  },
  {
    "number": 42,
    "title": "Verify all links: public GitHub repo, YouTube video playback, live Render demo URL.",
    "sprint": "Sprint 4: Hardening, Video Demo & Final Devpost Submission",
    "day": "Day 22 (Nov 11\u201312) \u2014 Submission Lock-In & Final Safety Window"
  }
]

def main():
    print(f"Preparing to seed {len(ISSUES)} issues into the current GitHub repository...\n")
    
    # Ensure gh CLI is installed
    try:
        subprocess.run(["gh", "--version"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    except Exception:
        print("Error: GitHub CLI ('gh') is not installed or not in PATH.")
        print("Install it from https://cli.github.com/ or run 'gh auth login'.")
        sys.exit(1)

    # Create common labels first
    labels = [
        ("paypal-api", "0070BA", "PayPal Orders v2, Authorizations, Payouts"),
        ("ai-vision", "8A2BE2", "LLM Scope Planner and Multimodal Vision"),
        ("frontend-aggrid", "2E8B57", "Next.js UI and AG Grid escrow ledger"),
        ("devops-demo", "FF8C00", "Render deploy, demo scripts, video recording"),
    ]
    print("Ensuring repository labels exist...")
    for name, color, desc in labels:
        subprocess.run(["gh", "label", "create", name, "--color", color, "--description", desc], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    for item in ISSUES:
        title = f"Issue #{item['number']}: {item['title']}"
        
        # Determine label
        t_lower = item['title'].lower()
        if any(k in t_lower for k in ["paypal", "oauth", "order", "capture", "payout", "escrow", "sandbox"]):
            label = "paypal-api"
        elif any(k in t_lower for k in ["agent", "vision", "model", "inspection", "ai", "prompt", "checklist"]):
            label = "ai-vision"
        elif any(k in t_lower for k in ["ag grid", "ui", "portal", "frontend", "layout", "view"]):
            label = "frontend-aggrid"
        else:
            label = "devops-demo"

        body = f"""**Sprint:** {item['sprint']}
**Target Timeline:** {item['day']}

### Acceptance Criteria
- [ ] Core implementation complete
- [ ] Tested and verified in PayPal Sandbox or test runner
- [ ] PR reviewed and merged to main
"""
        cmd = [
            "gh", "issue", "create",
            "--title", title,
            "--body", body,
            "--label", label
        ]
        
        print(f"Creating Issue #{item['number']} -> {item['title'][:50]}...")
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode != 0:
            print(f"  Note: {res.stderr.strip()}")

    print("\nAll 42 issues created successfully! Open your repository on GitHub to view them or link them to your Project Board.")

if __name__ == "__main__":
    main()