/** Read-only, bounded line comparison; never evaluates proposed code. */
export type DiffLine={kind:"same"|"added"|"removed";text:string};
const maxShown=180;
export function compareSource(original:string,replacement:string):{
  lines:DiffLine[];truncated:boolean;added:number;removed:number;unchanged:number
}{
  const a=original.split("\n"),b=replacement.split("\n");
  let rows:DiffLine[]=[];
  if(a.length<=240&&b.length<=240){
    // Bounded LCS, exact line-level diff. No outside diff tool or shell.
    const dp=Array.from({length:a.length+1},()=>new Uint16Array(b.length+1));
    for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)
      dp[i][j]=a[i]===b[j]?dp[i+1][j+1]+1:Math.max(dp[i+1][j],dp[i][j+1]);
    let i=0,j=0;
    while(i<a.length||j<b.length){
      if(i<a.length&&j<b.length&&a[i]===b[j]){rows.push({kind:"same",text:a[i]});i++;j++}
      else if(j<b.length&&(i===a.length||dp[i][j+1]>=dp[i+1][j]))rows.push({kind:"added",text:b[j++]});
      else rows.push({kind:"removed",text:a[i++]});
    }
  }else{
    // Large files: conservative comparison, no claim of minimal diff.
    let front=0;
    while(front<Math.min(a.length,b.length)&&a[front]===b[front])front++;
    let tail=0;
    while(tail<Math.min(a.length,b.length)-front&&a[a.length-1-tail]===b[b.length-1-tail])tail++;
    rows=[
      ...a.slice(0,front).map(text=>({kind:"same" as const,text})),
      ...a.slice(front,a.length-tail).map(text=>({kind:"removed" as const,text})),
      ...b.slice(front,b.length-tail).map(text=>({kind:"added" as const,text})),
      ...a.slice(a.length-tail).map(text=>({kind:"same" as const,text})),
    ];
  }
  const count=(kind:DiffLine["kind"])=>rows.filter(r=>r.kind===kind).length;
  const added=count("added"),removed=count("removed"),unchanged=count("same");
  if(rows.length<=maxShown)return {lines:rows,truncated:false,added,removed,unchanged};
  const context=60;
  return {lines:[...rows.slice(0,context),...rows.slice(-context)],
    truncated:true,added,removed,unchanged};
}
