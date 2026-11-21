/**
 * Safe, deterministic CSV-to-HTML dashboard worker recipe.
 * This is a fixed template, NOT generated code, a general Codeworker or a
 * substitute for isolated testing of arbitrary source. No network or imports.
 * The same verified renderer is used for stored hashes and downloaded bytes.
 */
import type {WorkerContract} from "./registry.ts";

export interface CsvDashboard {
  kind:"csv-dashboard-v1";
  title:string;
  columns:string[];
  rows:string[][];
  rowCount:number;
  categoryColumn:number;
  numericColumn:number|null;
  note:string;
}
const MAX_COLUMNS=12, MAX_ROWS=120, MAX_SOURCE=10000;
const fail=(message:string):never=>{throw new Error(message)};

/** Quoted multiline cells and escaped quotes are supported; malformed data fails closed. */
export function parseDashboardCsv(source:string):{columns:string[];rows:string[][];separator:string} {
  if(typeof source!=="string"||!source.trim()||source.length>MAX_SOURCE)
    fail("CSV ontbreekt of is te lang (maximaal 10.000 tekens).");
  const text=source.replace(/^\uFEFF/,"");
  // Detect a delimiter from the first logical header line, ignoring quotes.
  let header="",quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"'){
      if(quoted&&text[i+1]==='"'){header+='"';i++}
      else quoted=!quoted;
      continue;
    }
    if((c==="\n"||c==="\r")&&!quoted)break;
    header+=quoted?"":c;
  }
  const counts=[["\t",header.split("\t").length-1],
    [";",header.split(";").length-1],[",",header.split(",").length-1]] as const;
  const best=[...counts].sort((a,b)=>b[1]-a[1])[0];
  if(best[1]<1)fail("CSV heeft minstens twee kolommen nodig, gescheiden door een komma, puntkomma of tab.");
  const separator=best[0];
  const records:string[][]=[];
  let row:string[]=[],cell="",inQuotes=false,afterQuote=false;
  const appendCell=()=>{
    if(cell.length>450)fail("Een CSV-veld is te lang.");
    row.push(cell.trim());cell="";afterQuote=false;
    if(row.length>MAX_COLUMNS)fail("CSV heeft maximaal 12 kolommen.");
  };
  const appendRow=()=>{
    if(row.some(value=>value!==""))records.push(row);
    row=[];
    if(records.length>MAX_ROWS+1)fail("CSV bevat maximaal 120 gegevensrijen.");
  };
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(inQuotes){
      if(ch==='"'){
        if(text[i+1]==='"'){cell+='"';i++}else{inQuotes=false;afterQuote=true}
      }else cell+=ch;
    }else if(ch==='"'){
      if(cell.trim()!==""||afterQuote)fail("Ongeldige aanhalingstekens in CSV.");
      inQuotes=true;
    }else if(ch===separator){appendCell()}
    else if(ch==="\n"||ch==="\r"){
      appendCell();appendRow();
      if(ch==="\r"&&text[i+1]==="\n")i++;
    }else{
      if(afterQuote&&!/\s/.test(ch))fail("Ongeldige tekst na een gesloten CSV-veld.");
      if(!afterQuote)cell+=ch;
    }
    if(cell.length>450)fail("Een CSV-veld is te lang.");
  }
  if(inQuotes)fail("Niet-afgesloten aanhalingstekens in CSV.");
  appendCell();appendRow();
  if(records.length<2)fail("CSV heeft kolomnamen en minstens één gegevensrij nodig.");
  const columns=records[0];
  if(columns.length<2||columns.some(s=>!s||s.length>72)||new Set(columns.map(s=>s.toLowerCase())).size!==columns.length)
    fail("CSV-kolomnamen moeten gevuld, uniek en maximaal 72 tekens lang zijn.");
  const rows=records.slice(1);
  if(rows.some(r=>r.length!==columns.length))fail("CSV heeft verschillende aantallen kolommen per rij.");
  return {columns,rows,separator};
}
const numberValue=(value:string,separator:string):number|null=>{
  if(!value.trim())return null;
  const v=value.trim();
  const p=separator===";"?v.replace(",","."):v;
  if(!/^-?(?:\d+)(?:\.\d+)?$/.test(p))return null;
  const n=Number(p);
  return Number.isFinite(n)&&Math.abs(n)<1e12?n:null;
};
export function buildCsvDashboard(source:string,instruction:string):CsvDashboard {
  const {columns,rows,separator}=parseDashboardCsv(source);
  if(typeof instruction!=="string"||!instruction.trim()||instruction.length>1500)
    fail("Een geldige opdracht is nodig.");
  const numeric=columns.map((_,index)=>({
    index,valid:rows.filter(r=>numberValue(r[index],separator)!==null).length,
  }));
  const numericColumn=numeric.find(c=>c.valid>0&&c.valid>=Math.ceil(rows.length*.8))?.index??null;
  const categoryColumn=columns.findIndex((_,i)=>i!==numericColumn);
  return {
    kind:"csv-dashboard-v1",
    title:instruction.trim().split("\n")[0].slice(0,100),
    columns,rows,rowCount:rows.length,
    categoryColumn:Math.max(0,categoryColumn),numericColumn,
    note:"Vaste HTML-template met zoeken, categorie-filter, tabel en een overzichtsgrafiek. Geen externe verzoeken, AI-codegeneratie of inhoudelijke verificatie.",
  };
}
/** Browser runtime is encoded from this trusted function, never user code. */
function dashboardRuntime(){
  const d=JSON.parse(document.getElementById("data").textContent||"{}");
  const $=(id)=>document.getElementById(id);
  const make=(tag,value,className)=>{
    const x=document.createElement(tag);
    if(value!==undefined)x.textContent=String(value);
    if(className)x.className=className;
    return x;
  };
  const search=$("search"),category=$("category"),table=$("rows"),bars=$("bars");
  $("heading").textContent=d.title;
  $("subheading").textContent="Lokaal HTML-dashboard · vaste EAIwork-template";
  const labels=d.rows.map(r=>r[d.categoryColumn]||"Onbekend");
  for(const label of [...new Set(labels)].slice(0,120)){
    const opt=make("option",label);opt.value=label;category.append(opt);
  }
  const head=$("thead");
  for(const col of d.columns)head.append(make("th",col));
  function draw(){
    const q=search.value.trim().toLocaleLowerCase();
    const selected=category.value;
    const filtered=d.rows.filter(r=>
      (!selected||r[d.categoryColumn]===selected)&&
      (!q||r.some(v=>v.toLocaleLowerCase().includes(q))));
    $("count").textContent=String(filtered.length);
    $("columns").textContent=String(d.columns.length);
    const amount=d.numericColumn===null?null:filtered.reduce((acc,r)=>{
      const raw=(r[d.numericColumn]||"").trim().replace(",",".");
      const n=Number(raw);return acc+(raw&&Number.isFinite(n)?n:0);
    },0);
    $("total").textContent=amount===null?"n.v.t.":new Intl.NumberFormat("nl-NL",{maximumFractionDigits:2}).format(amount);
    table.replaceChildren();
    for(const row of filtered){
      const tr=make("tr");for(const v of row)tr.append(make("td",v));table.append(tr);
    }
    bars.replaceChildren();
    const totals=new Map();
    for(const row of filtered){
      const key=row[d.categoryColumn]||"Onbekend";
      const raw=d.numericColumn===null?"":String(row[d.numericColumn]||"").trim().replace(",",".");
      const value=raw&&Number.isFinite(Number(raw))?Number(raw):0;
      totals.set(key,(totals.get(key)||0)+(d.numericColumn===null?1:value));
    }
    const items=[...totals].sort((a,b)=>b[1]-a[1]).slice(0,10);
    const max=Math.max(1,...items.map(a=>Math.abs(a[1])));
    $("chart-label").textContent=(d.numericColumn===null?"Aantal per ":"Totaal per ")+d.columns[d.categoryColumn];
    for(const [name,n] of items){
      const line=make("div",undefined,"bar-line");
      line.append(make("span",name,"bar-name"));
      const track=make("div",undefined,"bar-track");
      const bar=make("div",undefined,"bar-fill");bar.style.width=String(Math.max(0,Math.abs(n)/max*100))+"%";
      track.append(bar);line.append(track);
      line.append(make("span",new Intl.NumberFormat("nl-NL",{maximumFractionDigits:2}).format(n),"bar-number"));
      bars.append(line);
    }
    if(!items.length)bars.append(make("p","Geen resultaten voor deze filters.","empty"));
  }
  search.addEventListener("input",draw);
  category.addEventListener("change",draw);
  draw();
}
const STYLES=[
  "*{box-sizing:border-box}body{margin:0;background:#f6f8f6;color:#20352b;font-family:Inter,system-ui,Arial,sans-serif;font-size:13px}",
  "header{padding:18px 5vw;background:#fff;border-bottom:1px solid #dae3db}header small{color:#779082;font-size:11px}",
  "main{max-width:1200px;padding:26px 20px;margin:auto}h1{font-size:clamp(21px,4vw,34px);letter-spacing:-.045em;margin:0 0 5px;line-height:1.25}h2{font-size:13px;margin:0 0 15px}",
  ".muted{color:#75897c;font-size:11px;margin:0}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:24px 0}",
  ".kpi,.panel{background:white;border:1px solid #dde5de;border-radius:11px}.kpi{padding:17px}.kpi strong{font-size:26px;font-weight:650;display:block}.kpi span{color:#7a9080;font-size:11px}",
  ".panel{padding:20px;margin:12px 0}.controls{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:14px}",
  "input,select{font:inherit;color:#254432;padding:11px 12px;min-width:180px;max-width:100%;border:1px solid #d3e0d6;border-radius:8px;background:white}",
  ".bar-line{display:grid;grid-template-columns:minmax(85px,150px) 1fr 65px;gap:9px;align-items:center;margin:12px 0;font-size:12px}",
  ".bar-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bar-track{height:13px;background:#ecf3ed;border-radius:4px;overflow:hidden}",
  ".bar-fill{height:100%;background:#458263;border-radius:4px}.bar-number{text-align:right;font-variant-numeric:tabular-nums}",
  ".table-outer{overflow:auto;max-height:360px}table{width:100%;border-collapse:collapse;text-align:left}th,td{border-bottom:1px solid #ebf0ec;padding:11px 9px;white-space:nowrap}",
  "th{position:sticky;top:0;background:#fff;color:#456e54;font-size:11px}td{font-size:12px}.empty{color:#799285}",
  "footer{font-size:10px;color:#809488;padding:18px 0}@media(max-width:590px){main{padding:16px 12px}.panel{padding:14px}.kpi{padding:12px}.kpi strong{font-size:22px}.bar-line{grid-template-columns:85px 1fr 52px}}",
].join("");
const escapeHtml=(s:string)=>s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
 .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
export function renderCsvDashboardHtml(data:CsvDashboard):string {
  if(!data||data.kind!=="csv-dashboard-v1"||!Array.isArray(data.columns)||
     !Array.isArray(data.rows)||data.columns.length<2||data.columns.length>MAX_COLUMNS||
     data.rows.length>MAX_ROWS||data.rows.some(r=>!Array.isArray(r)||
       r.length!==data.columns.length||r.some(v=>typeof v!=="string"||v.length>450))||
     typeof data.title!=="string"||data.title.length>100)
    fail("Ongeldige gegevens voor een HTML-dashboard.");
  const safe=JSON.stringify(data).replace(/</g,"\\u003c").replace(/>/g,"\\u003e")
    .replace(/&/g,"\\u0026").replace(/\u2028/g,"\\u2028").replace(/\u2029/g,"\\u2029");
  return '<!doctype html><html lang="nl"><head><meta charset="utf-8">'+
    '<meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<meta name="referrer" content="no-referrer">'+
    '<title>'+escapeHtml(data.title)+' · EAIwork dashboard</title><style>'+STYLES+'</style></head>'+
    '<body><header><small>EAIwork / vaste dashboardtemplate</small></header><main>'+
    '<h1 id="heading"></h1><p class="muted" id="subheading"></p>'+
    '<div class="summary"><div class="kpi"><strong id="count">0</strong><span>Rijen</span></div>'+
    '<div class="kpi"><strong id="columns">0</strong><span>Kolommen</span></div>'+
    '<div class="kpi"><strong id="total">0</strong><span>Numeriek totaal</span></div></div>'+
    '<section class="panel"><h2>Verkennen</h2><div class="controls">'+
    '<label><span>Zoeken</span><br><input id="search" placeholder="Zoek in alle kolommen" autocomplete="off"></label>'+
    '<label><span>Categorie</span><br><select id="category"><option value="">Alle categorieën</option></select></label>'+
    '</div></section><section class="panel"><h2 id="chart-label">Grafiek</h2><div id="bars"></div></section>'+
    '<section class="panel"><h2>Gegevens</h2><div class="table-outer"><table><thead><tr id="thead"></tr></thead>'+
    '<tbody id="rows"></tbody></table></div></section>'+
    '<footer>Automatisch gegenereerd vanuit aangeleverde CSV met een vaste, lokaal werkende HTML-template. '+
    'Geen externe bronnen, modelcode of onafhankelijke inhoudelijke beoordeling.</footer></main>'+
    '<script id="data" type="application/json">'+safe+'</script>'+
    '<script>('+dashboardRuntime.toString()+')();</script></body></html>';
}
export function dashboardContract():WorkerContract {
  return {id:"csv-dashboard-renderer",version:"1.0.0",name:"CSV dashboard-template",
    specialization:"Deterministic CSV parsing and interactive standalone HTML dashboard generation",
    taskKinds:["csv-dashboard"],
    inputSchema:{type:"object",properties:{text:{type:"string"}},required:["text"],additionalProperties:false},
    outputSchema:{type:"object",properties:{kind:{const:"csv-dashboard-v1"},title:{type:"string"},columns:{type:"array"},rows:{type:"array"},rowCount:{type:"integer"}},required:["kind","title","columns","rows","rowCount"],additionalProperties:false},
    tools:[],requestedPermissions:[],modelPolicy:{preferred:"deterministic"},
    testSuite:"csv-dashboard-fixed-fixture-v1",
    stopConditions:["invalid-csv","fixture-failure","output-size-limit"],
    recipe:{kind:"builtin-dashboard",steps:["csv-parse","dashboard-render"]},
  };
}
export function safeDashboardContract(c:WorkerContract):boolean {
  // Allow no model-supplied variant: fixed ID, version, input/output schema and
  // exact bundled recipe. There is no executable source in this contract.
  return JSON.stringify(c)===JSON.stringify(dashboardContract());
}
export function evaluateDashboardFixtures(contract:WorkerContract){
  if(!safeDashboardContract(contract))fail("Niet-vertrouwd dashboard-recept.");
  const cases=[
    {text:"Afdeling;Waarde\nA;12\nB;25",rows:2,columns:2},
    {text:'"Naam","Score"\n"Een, twee",5\n"Drie",9',rows:2,columns:2},
    {text:"Naam\tAantal\r\nNoord\t3\r\nZuid\t7",rows:2,columns:2},
    {text:"Gemeente,Inwoners\nRotterdam,600\nUtrecht,300",rows:2,columns:2},
  ];
  let passed=0;
  for(const item of cases){
    const data=buildCsvDashboard(item.text,"Bouw een CSV-dashboard");
    const html=renderCsvDashboardHtml(data);
    if(data.rowCount===item.rows&&data.columns.length===item.columns&&
       html.includes('id="category"')&&html.includes('id="search"')&&
       !html.includes('fetch(')&&html.includes('type="application/json"'))
      passed++;
  }
  return {numerator:passed,denominator:cases.length,metric:"fixture-pass",
    taskKind:"csv-dashboard",dataset:"csv-dashboard-fixed-fixture-v1",
    suiteVersion:"csv-dashboard-fixed-fixture-v1",cohort:"fixed-fixtures",
    note:"Four fixed parsing and HTML rendering cases. This does not validate arbitrary data or semantic accuracy."};
}
