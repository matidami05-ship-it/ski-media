#!/usr/bin/env python3
"""Serves Ski Media and forwards a few API calls (browsers block them). Usage: python3 server.py [--lan] [port]"""
import http.server, urllib.request, urllib.parse, urllib.error, os, sys
ALLOW={"api.real-debrid.com","api.simkl.com","api.alldebrid.com","www.premiumize.me","api.torbox.app"}
class H(http.server.SimpleHTTPRequestHandler):
    def proxy(self):
        u=urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get("url",[""])[0]
        p=urllib.parse.urlparse(u)
        if p.scheme!="https" or p.hostname not in ALLOW:
            return self.send_error(403,"Host not allowed")
        n=int(self.headers.get("Content-Length") or 0)
        body=self.rfile.read(n) if n else None
        h={k:v for k,v in self.headers.items() if k.lower() in("authorization","content-type","simkl-api-key")}
        h["User-Agent"]="SkiMedia/1.0"
        try:
            r=urllib.request.urlopen(urllib.request.Request(u,data=body,headers=h,method=self.command),timeout=30)
            code,data,ct=r.status,r.read(),r.headers.get("Content-Type","application/json")
        except urllib.error.HTTPError as e:
            code,data,ct=e.code,e.read(),e.headers.get("Content-Type","application/json")
        except Exception as e:
            return self.send_error(502,str(e)[:100])
        self.send_response(code);self.send_header("Content-Type",ct);self.send_header("Content-Length",str(len(data)));self.end_headers();self.wfile.write(data)
    def do_GET(self):
        return self.proxy() if self.path.startswith("/api/proxy") else super().do_GET()
    def do_POST(self): self.proxy()
    do_PUT=do_DELETE=do_POST
args=[a for a in sys.argv[1:] if a!="--lan"]
port=int(args[0]) if args else 8080
host="0.0.0.0" if "--lan" in sys.argv else "127.0.0.1"
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)),"www"))
print(f"Ski Media running at http://{host if host!='0.0.0.0' else 'YOUR-COMPUTER-IP'}:{port}")
http.server.ThreadingHTTPServer((host,port),H).serve_forever()
