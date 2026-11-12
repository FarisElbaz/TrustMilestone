import request from "supertest"; import app from "../src/app";
test("updates product stock",async()=>{ // REQ-1
 const r=await request(app).patch("/products/p1/stock").send({stock:8}); expect(r.status).toBe(200); expect(r.body).toEqual({id:"p1",stock:8}); });
test("rejects non-integer stock",async()=>{ // REQ-2
 const r=await request(app).patch("/products/p1/stock").send({stock:1.5}); expect(r.status).toBe(400); });
test("returns 404 for unknown product",async()=>{ // REQ-3
 const r=await request(app).patch("/products/no/stock").send({stock:2}); expect(r.status).toBe(404); });