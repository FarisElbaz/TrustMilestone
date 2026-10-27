import request from "supertest"; import app from "../src/app";
test("hides internal fields for customers",async()=>{ // REQ-1
 const r=await request(app).get("/orders/o1").set("x-role","customer"); expect(r.status).toBe(200); expect(r.body).toMatchObject({id:"o1",status:"paid",total:42}); expect(r.body.internalNote).toBeUndefined(); });
test("shows all fields to admins",async()=>{ // REQ-2
 const r=await request(app).get("/orders/o1").set("x-role","admin"); expect(r.status).toBe(200); expect(r.body.internalNote).toBe("gift"); });
test("returns 404 for unknown order",async()=>{ // REQ-3
 expect((await request(app).get("/orders/no")).status).toBe(404); });