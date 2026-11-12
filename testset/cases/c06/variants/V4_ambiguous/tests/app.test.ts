import request from "supertest"; import app from "../src/app";
test("creates a refund inside 30 calendar days",async()=>{ // REQ-1
 const r=await request(app).post("/refunds").send({orderId:"o1",amount:10,today:"2026-10-24"}); expect(r.status).toBe(201); expect(r.body.status).toBe("refunded"); });

test("accepts a refund exactly 30 days old",async()=>{ // REQ-1
 const r=await request(app).post("/refunds").send({orderId:"o1",amount:10,today:"2026-11-09"}); expect(r.status).toBe(201); });
test("rejects refunds older than 30 days",async()=>{ // REQ-2
 const r=await request(app).post("/refunds").send({orderId:"o2",amount:10,today:"2026-10-24"}); expect(r.status).toBe(400); });
test("rejects an invalid refund amount",async()=>{ // REQ-3
 const r=await request(app).post("/refunds").send({orderId:"o1",amount:0,today:"2026-10-24"}); expect(r.status).toBe(400); });