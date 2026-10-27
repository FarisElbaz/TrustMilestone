import request from "supertest"; import app from "../src/app";
test("adds a new cart item",async()=>{ // REQ-1
 const r=await request(app).post("/carts/items").send({cartId:"c1",productId:"p1",quantity:2}); expect(r.status).toBe(201); expect(r.body).toContainEqual({productId:"p1",quantity:2}); });
test("merges a duplicate product",async()=>{ // REQ-2
 await request(app).post("/carts/items").send({cartId:"c1",productId:"p2",quantity:2}); const r=await request(app).post("/carts/items").send({cartId:"c1",productId:"p2",quantity:3}); expect(r.body.filter((x:any)=>x.productId==="p2")).toEqual([{productId:"p2",quantity:5}]); });
test("rejects invalid quantity",async()=>{ // REQ-3
 expect((await request(app).post("/carts/items").send({cartId:"c1",productId:"p3",quantity:0})).status).toBe(400); });