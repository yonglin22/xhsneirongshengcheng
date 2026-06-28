/* 轻量、无依赖的 Excel(.xlsx)/CSV 解析器：window.parseSheet(file) -> Promise<rows[][]>（每行是字符串数组）。
   .xlsx 用浏览器内置 DecompressionStream('deflate-raw') 解压 ZIP，再读 sharedStrings + sheet1。
   仅取第一个工作表；空单元格按列补齐。Chromium 支持 deflate-raw，目标环境即 Chrome 插件用户。 */
(function(){
  function u16(b,o){ return b[o]|(b[o+1]<<8); }
  function u32(b,o){ return (b[o]|(b[o+1]<<8)|(b[o+2]<<16)|(b[o+3]<<24))>>>0; }
  async function inflateRaw(bytes){
    if(typeof DecompressionStream==='undefined') throw new Error('浏览器不支持解压，请改用 CSV 导入');
    const ds=new DecompressionStream('deflate-raw');
    const stream=new Response(bytes).body.pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  // 解析 ZIP，返回 { 文件名: Uint8Array }
  async function unzip(buf){
    const b=new Uint8Array(buf); const out={};
    // 找 EOCD
    let i=b.length-22;
    while(i>=0 && u32(b,i)!==0x06054b50) i--;
    if(i<0) throw new Error('不是有效的 .xlsx 文件');
    let cdOff=u32(b,i+16), n=u16(b,i+10), p=cdOff;
    for(let k=0;k<n;k++){
      if(u32(b,p)!==0x02014b50) break;
      const method=u16(b,p+10), csize=u32(b,p+20), nameLen=u16(b,p+28), extraLen=u16(b,p+30), cmtLen=u16(b,p+32), lho=u32(b,p+42);
      const name=new TextDecoder().decode(b.subarray(p+46,p+46+nameLen));
      // 本地头：30 字节固定 + 文件名 + extra
      const lNameLen=u16(b,lho+26), lExtraLen=u16(b,lho+28);
      const dataStart=lho+30+lNameLen+lExtraLen;
      const comp=b.subarray(dataStart, dataStart+csize);
      if(/sharedStrings\.xml$|sheet1\.xml$|workbook\.xml$|worksheets\/sheet\d+\.xml$/.test(name)){
        out[name]= method===0 ? comp.slice() : await inflateRaw(comp);
      }
      p+=46+nameLen+extraLen+cmtLen;
    }
    return out;
  }
  function decode(bytes){ return bytes?new TextDecoder().decode(bytes):''; }
  function colIdx(ref){ const m=/^([A-Z]+)/.exec(ref||''); if(!m) return -1; let n=0; for(const ch of m[1]) n=n*26+(ch.charCodeAt(0)-64); return n-1; }
  function unesc(s){ return String(s)
    .replace(/&#x([0-9a-fA-F]+);/g,(_,h)=>String.fromCodePoint(parseInt(h,16)))
    .replace(/&#(\d+);/g,(_,d)=>String.fromCodePoint(parseInt(d,10)))
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&'); }
  function parseShared(xml){
    const arr=[]; if(!xml) return arr;
    const re=/<si>([\s\S]*?)<\/si>/g; let m;
    while((m=re.exec(xml))){ let t=''; const tre=/<t[^>]*>([\s\S]*?)<\/t>/g; let tm; while((tm=tre.exec(m[1]))) t+=tm[1]; arr.push(unesc(t)); }
    return arr;
  }
  function parseSheetXml(xml, shared){
    const rows=[]; if(!xml) return rows;
    const rowRe=/<row[^>]*>([\s\S]*?)<\/row>/g; let rm;
    while((rm=rowRe.exec(xml))){
      const cells=[]; const cRe=/<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g; let cm;
      while((cm=cRe.exec(rm[1]))){
        const attrs=cm[1]||cm[3]||''; const inner=cm[2]||'';
        const ref=(/r="([^"]+)"/.exec(attrs)||[])[1]; const t=(/t="([^"]+)"/.exec(attrs)||[])[1];
        let val='';
        if(t==='inlineStr'){ const im=/<t[^>]*>([\s\S]*?)<\/t>/.exec(inner); val=im?unesc(im[1]):''; }
        else { const vm=/<v>([\s\S]*?)<\/v>/.exec(inner); val=vm?vm[1]:''; if(t==='s') val=shared[parseInt(val)]||''; else val=unesc(val); }
        const ci=colIdx(ref); if(ci>=0){ cells[ci]=val; } else cells.push(val);
      }
      for(let i=0;i<cells.length;i++) if(cells[i]==null) cells[i]='';
      rows.push(cells);
    }
    return rows;
  }
  function parseCSV(text){
    const rows=[]; let row=[], cur='', q=false;
    for(let i=0;i<text.length;i++){ const c=text[i];
      if(q){ if(c==='"'){ if(text[i+1]==='"'){ cur+='"'; i++; } else q=false; } else cur+=c; }
      else { if(c==='"') q=true; else if(c===','){ row.push(cur); cur=''; } else if(c==='\t'&&row.length===0&&cur===''){ /*allow tab as sep too*/ row.push(cur); cur=''; }
        else if(c==='\n'){ row.push(cur); rows.push(row); row=[]; cur=''; } else if(c==='\r'){} else cur+=c; } }
    if(cur!==''||row.length){ row.push(cur); rows.push(row); }
    return rows;
  }
  window.parseSheet=async function(file){
    const name=(file.name||'').toLowerCase();
    if(name.endsWith('.csv')||name.endsWith('.txt')||name.endsWith('.tsv')){
      const text=await file.text(); return parseCSV(text);
    }
    const buf=await file.arrayBuffer();
    const files=await unzip(buf);
    const shared=parseShared(decode(files['xl/sharedStrings.xml']));
    let sheetKey=Object.keys(files).find(k=>/worksheets\/sheet1\.xml$/.test(k))||Object.keys(files).find(k=>/worksheets\/sheet\d+\.xml$/.test(k));
    return parseSheetXml(decode(files[sheetKey]), shared);
  };
})();
