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
      return{url:u.download,id:u.id}},
    async transcode(tok,id){try{const r=await Ski.rd.call(tok,"/streaming/transcode/"+id);const pick=o=>o&&(o.full||Object.values(o)[0]);return pick(r.apple)||pick(r.liveMP4)||pick(r.h264WebM)||""}catch(e){return""}}
  }
};

Ski.tb={
  async call(tok,path,opt={}){
    const r=await Ski.px("https://api.torbox.app/v1/api"+path,{...opt,headers:{Authorization:"Bearer "+tok,...(opt.headers||{})}});
    if(r.status===401||r.status===403)throw new Error("TorBox rejected your API key");
    let j=null;try{j=await r.json()}catch(e){}
    if(!r.ok||(j&&j.success===false))throw new Error("TorBox: "+((j&&(j.detail||j.error))||("error "+r.status)));
    return j},
  async resolve(tok,hash,fileIdx,onStatus){
    const fd=new FormData();fd.append("magnet","magnet:?xt=urn:btih:"+hash);fd.append("seed","1");fd.append("allow_zip","false");
    const add=await Ski.tb.call(tok,"/torrents/createtorrent",{method:"POST",body:fd});
    const id=add.data&&(add.data.torrent_id||add.data.queued_id);
    if(!id)throw new Error("TorBox didn't accept this source. Try another.");
    let info=null;
    for(let n=0;n<30;n++){
      const r=await Ski.tb.call(tok,"/torrents/mylist?id="+id+"&bypass_cache=true");
      info=Array.isArray(r.data)?r.data[0]:r.data;
      if(info&&(info.download_finished||info.download_present)&&(info.files||[]).length)break;
      if(info&&/error|failed|dead/i.test(info.download_state||""))throw new Error("TorBox: "+info.download_state);
      if(onStatus)onStatus(((info&&info.download_state)||"queued")+" "+Math.round(((info&&info.progress)||0)*100)+"%");
      await new Promise(r=>setTimeout(r,2000))}
    if(!info||!(info.files||[]).length||!(info.download_finished||info.download_present))throw new Error("Not ready yet. Try another source.");
    const vids=info.files.filter(f=>/\.(mp4|mkv|webm|m4v|avi)$/i.test(f.name||f.short_name||"")).sort((a,b)=>b.size-a.size);
    const pick=(fileIdx!=null&&info.files[fileIdx]&&/\.(mp4|mkv|webm|m4v|avi)$/i.test(info.files[fileIdx].name||""))?info.files[fileIdx]:(vids[0]||info.files[0]);
    const d=await Ski.tb.call(tok,"/torrents/requestdl?token="+encodeURIComponent(tok)+"&torrent_id="+id+"&file_id="+pick.id+"&zip_link=false");
    if(!d.data)throw new Error("TorBox couldn't make a link");
    return{url:d.data,id:null}}
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
