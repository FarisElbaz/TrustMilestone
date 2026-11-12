import request from "supertest"; import app from "../src/app";
test("filters products by category",async()=>{ // REQ-1
 const r=await request(app).get("/products?category=food&limit=10"); expect(r.status).toBe(200); expect(r.body.items.map((x:any)=>x.id)).toEqual(["p1","p4"]); expect(r.body.total).toBe(2); });
test("paginates products",async()=>{ // REQ-2
 const r=await request(app).get("/products?page=2&limit=2"); expect(r.status).toBe(200); expect(r.body.items.map((x:any)=>x.id)).toEqual(["p3","p4"]); expect(r.body.page).toBe(2); });