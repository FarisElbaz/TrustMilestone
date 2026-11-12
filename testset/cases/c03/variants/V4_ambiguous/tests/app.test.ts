import request from "supertest"; import app from "../src/app";
test("cancels a pending order",async()=>{ // REQ-1
 const r=await request(app).post("/orders/o1/cancel"); expect(r.status).toBe(200); expect(r.body.status).toBe("cancelled"); });
test("does not cancel a shipped order",async()=>{ // REQ-2
 const r=await request(app).post("/orders/o2/cancel"); expect(r.status).toBe(409); });
test("returns not found for an unknown order",async()=>{ // REQ-3
 const r=await request(app).post("/orders/no/cancel"); expect(r.status).toBe(404); });