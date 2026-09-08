import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const args = new Map();
for (let i=2;i<process.argv.length;i+=2) {
  if (!["--file","--port"].includes(process.argv[i]) || !process.argv[i+1]) throw new Error("Use --file <review.html> [--port <number>]");
  args.set(process.argv[i],process.argv[i+1]);
}
const file=path.resolve(args.get("--file")??"tmp/sak-voice/review/index.html");
if (!fs.statSync(file).isFile()) throw new Error("Review file not found");
const port=Number(args.get("--port")??0);
if (!Number.isInteger(port)||port<0||port>65535) throw new Error("Invalid port");
const server=http.createServer((req,res)=>{
  if (req.method!=="GET" || !["/","/index.html"].includes(req.url)) {res.writeHead(404);res.end();return}
  res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});
  res.end(fs.readFileSync(file));
});
server.listen(port,"127.0.0.1",()=>console.log("Review: http://127.0.0.1:"+server.address().port));
