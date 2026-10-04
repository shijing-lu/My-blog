import http from 'node:http';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {dirname, resolve, extname, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.webp':'image/webp','.png':'image/png','.woff2':'font/woff2','.mp4':'video/mp4'};
const server=http.createServer(async(req,res)=>{
  try {
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const file=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
    if(!file.startsWith(root+sep)){res.writeHead(403);res.end();return;}
    const info=await stat(file);if(!info.isFile())throw new Error('Not a file');
    res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');
    res.setHeader('Accept-Ranges','bytes');res.setHeader('Cache-Control','no-cache');
    const range=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    if(range){const start=Number(range[1]);const end=Math.min(range[2]?Number(range[2]):info.size-1,info.size-1);if(start>end){res.writeHead(416,{'Content-Range':`bytes */${info.size}`});res.end();return;}res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${info.size}`,'Content-Length':end-start+1});if(req.method==='HEAD'){res.end();return;}createReadStream(file,{start,end}).pipe(res);}
    else{res.writeHead(200,{'Content-Length':info.size});if(req.method==='HEAD'){res.end();return;}createReadStream(file).pipe(res);}
  }catch{res.writeHead(404);res.end('Not found');}
});
server.listen(4319,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:4319/'));
