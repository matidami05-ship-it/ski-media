// Ski Media engine: Stremio addon protocol + Real-Debrid + Simkl.
// In a browser, debrid/Simkl calls go through server.py. In the Android app they go out directly via native networking.
const Ski={
  async j(url,opt){const r=await fetch(url,opt);if(!r.ok)throw new Error("HTTP "+r.status);return r.json()},
  base(u){return u.replace(/\/manifest\.json$/,"").replace(/\/$/,"")},
  async addon(u){const b=Ski.base(u),m=await Ski.j(b+"/manifest.json");
    return{url:b,name:m.name||"Addon",
      cats:(m.catalogs||[]).filter(c=>!(c.extra||[]).some(e=>e.isRequired)).map(c=>({type:c.type,id:c.id,name:c.name||c.id})),
      res:(m.resources||[]).map(r=>r.name||r)}},
  catalog(a,c){return Ski.j(`${a.url}/catalog/${c.type}/${c.id}.json`).then(r=>r.metas||[])},
  async streams(addons,type,id){const out=[];
    await Promise.all(addons.filter(a=>a.res.includes("stream")).map(async a=>{
      try{const r=await Ski.j(`${a.url}/stream/${type}/${encodeURIComponent(id)}.json`);(r.streams||[]).forEach(s=>out.push({...s,addon:a.name}))}catch(e){}}));
    return out},
  native(){return !!(window.Capacitor&&Capacitor.isNativePlatform&&Capacitor.isNativePlatform())},
  px(url,opt){return Ski.native()?fetch(url,opt):fetch("/api/proxy?url="+encodeURIComponent(url),opt)},
  rd:{
    async call(tok,path,opt={}){
      const r=await Ski.px("https://api.real-debrid.com/rest/1.0"+path,{...opt,headers:{Authorization:"Bearer "+tok,...(opt.headers||{})}});
      if(r.status===204)return{};if(r.status===401)throw new Error("Real-Debrid rejected your token");
      if(!r.ok)throw new Error("Real-Debrid error "+r.status);return r.json()},
    async resolve(tok,hash,fileIdx,onStatus){
      const F={"Content-Type":"application/x-www-form-urlencoded"};
      const add=await Ski.rd.call(tok,"/torrents/addMagnet",{method:"POST",headers:F,body:"magnet="+encodeURIComponent("magnet:?xt=urn:btih:"+hash)});
      let info=await Ski.rd.call(tok,"/torrents/info/"+add.id);
      if(info.status==="waiting_files_selection"){
        const vids=info.files.filter(f=>/\.(mp4|mkv|webm|m4v|avi)$/i.test(f.path)).sort((a,b)=>b.bytes-a.bytes);
        const pick=(fileIdx!=null&&info.files[fileIdx])||vids[0]||info.files[0];
        await Ski.rd.call(tok,"/torrents/selectFiles/"+add.id,{method:"POST",headers:F,body:"files="+pick.id})}
      for(let n=0;n<30;n++){
        info=await Ski.rd.call(tok,"/torrents/info/"+add.id);
        if(info.status==="downloaded")break;
        if(["magnet_error","error","virus","dead"].includes(info.status))throw new Error("Real-Debrid: "+info.status);
        if(onStatus)onStatus(info.status+" "+(info.progress||0)+"%");
        await new Promise(r=>setTimeout(r,2000))}
      if(info.status!=="downloaded")throw new Error("Not ready yet. Try another source.");
      const u=await Ski.rd.call(tok,"/unrestrict/link",{method:"POST",headers:F,body:"link="+encodeURIComponent(info.links[0])});
      return u.download}
  }
};

// Simkl: PIN sign-in, sync, scrobble. Calls go through server.py.
Ski.simkl={
  async call(cid,tok,path,opt={}){
    const h={"simkl-api-key":cid,"Content-Type":"application/json"};if(tok)h.Authorization="Bearer "+tok;
    const r=await Ski.px("https://api.simkl.com"+path,{...opt,headers:h});
    if(r.status===401)throw new Error("Simkl rejected the sign-in. Link again.");
    if(!r.ok)throw new Error("Simkl error "+r.status);
    const t=await r.text();return t?JSON.parse(t):{}},
  pin(cid){return Ski.simkl.call(cid,"","/oauth/pin?client_id="+encodeURIComponent(cid))},
  poll(cid,code){return Ski.simkl.call(cid,"","/oauth/pin/"+encodeURIComponent(code)+"?client_id="+encodeURIComponent(cid))}
};
