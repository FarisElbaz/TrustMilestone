import request from "supertest"; import app from "../src/app";
test("applies a valid discount code",async()=>{ // REQ-1
 const r=await request(app).post("/orders/discount").send({productId:"p1",quantity:2,code:"SAVE10"}); expect(r.status).toBe(200); expect(r.body).toEqual({subtotal:200,discount:20,total:180}); });
test("rejects an unknown discount code",async()=>{ // REQ-2
 const r=await request(app).post("/orders/discount").send({productId:"p1",quantity:1,code:"NOPE"}); expect(r.status).toBe(400); });