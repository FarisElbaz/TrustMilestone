import express from "express";
const app=express(); app.use(express.json());
const products:Record<string,number>={p1:12.5,p2:4}; let next=1;
app.post("/orders",(req,res)=>{const {productId,quantity}=req.body||{}; if(typeof productId!=="string"||typeof quantity!=="number"||quantity<=0)return res.status(400).json({error:"invalid quantity"}); if(products[productId]===undefined)return res.status(404).json({error:"product not found"}); const order={id:String(next++),productId,quantity,total:products[productId]*quantity}; return res.status(201).json(order);});
export default app;