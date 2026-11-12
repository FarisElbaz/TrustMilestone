import request from "supertest"; import app from "../src/app";
test("creates an order with its total",async()=>{ // REQ-1
 const r=await request(app).post("/orders").send({productId:"p1",quantity:2}); expect(r.status).toBe(201); expect(r.body).toMatchObject({id:"1",productId:"p1",quantity:2,total:25}); });
test("rejects a negative quantity",async()=>{ // REQ-2
 const r=await request(app).post("/orders").send({productId:"p1",quantity:-1}); expect(r.status).toBe(400); });