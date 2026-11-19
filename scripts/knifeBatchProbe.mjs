// Release-page experiment only. A frozen viewport and unselected benchmark graph.
export function installKnifeBatchProbe({chunkSize,lazy,spatial}) {
  const ns='http://www.w3.org/2000/svg'
  window.knifeBatchEvidence=[]
  window.addEventListener('pointerdown',()=>{
    if(!document.querySelector('[data-knife-cursor]')) return
    const originals=[...document.querySelectorAll('.react-flow__edges [data-edge]')]
    const first=originals[0], svg=first.ownerSVGElement.cloneNode(false)
    svg.removeAttribute('id');svg.style.pointerEvents='none';svg.style.visibility='visible'
    const group=document.createElementNS(ns,'g'), merged=document.createElementNS(ns,'path')
    merged.setAttribute('class',first.getAttribute('class'));merged.setAttribute('vector-effect','non-scaling-stroke')
    group.append(merged);svg.append(group)
    const data=originals.map(p=>[p,p.getAttribute('d')]); const record={initial:data.length,minimum:data.length,updates:0};window.knifeBatchEvidence.push(record)
    // Group similarly located curves before partitioning. For the fixture's
    // cubic paths the midpoint is the Bernstein blend at t=1/2.
    if(spatial){
      const ymid=d=>{const a=d.match(/[-+]?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?/gi).map(Number);return (a[1]+3*a[3]+3*a[5]+a[7])/8}
      const y=new Map(data.map(([p,d])=>[p,ymid(d)]));data.sort(([a],[b])=>y.get(a)-y.get(b))
    }
    const chunks=[], owner=new Map();let count=data.length
    record.visited=0;record.rewritten=0
    for(let i=0;i<data.length;i+=chunkSize){
      const path=i===0?merged:merged.cloneNode(false);if(i)group.append(path)
      const chunk={path,edges:data.slice(i,i+chunkSize),previous:-1};chunks.push(chunk)
      for(const [p] of chunk.edges)owner.set(p,chunk)
    }
    record.refreshIntervals=[];const refresh=(dirty=chunks)=>{const begin=performance.now()
      for(const chunk of dirty){record.visited+=chunk.edges.length
        const alive=chunk.edges.filter(([p])=>p.isConnected&&!p.hasAttribute('data-knife-pending'))
        if(alive.length!==chunk.previous){count+=alive.length-(chunk.previous<0?chunk.edges.length:chunk.previous);record.rewritten+=alive.length;chunk.path.setAttribute('d',alive.map(([,d])=>d).join(' '));chunk.previous=alive.length}
      }
      if(count<record.minimum)record.lastCutObserved=performance.now();record.minimum=Math.min(record.minimum,count);record.updates++;record.refreshIntervals.push([begin,performance.now()])
    }
    const parent=first.ownerSVGElement.parentElement
    const style=document.createElement('style');style.textContent='.react-flow__edges{visibility:hidden!important}'
    function activate(){
      refresh();parent.before(svg);Object.assign(svg.style,{position:'absolute',left:'0',top:'0',width:'1px',height:'1px',overflow:'visible'});document.head.append(style)
      record.activated=true;record.visible=[...group.children].some(p=>getComputedStyle(p).visibility==='visible' && getComputedStyle(p).stroke!=='none' && p.getBoundingClientRect().width>0)
    }
    record.activated=false;record.visible=getComputedStyle(first).visibility==='visible'
    if(!lazy)activate()
    const obs=new MutationObserver(records=>{if(record.activated)refresh(spatial?new Set(records.map(r=>owner.get(r.target)).filter(Boolean)):chunks);else activate()});obs.observe(parent,{attributes:true,subtree:true,attributeFilter:['data-knife-pending']})
    const events=['pointerup','pointercancel','blur','keyup']
    function end(e){if(e.type==='keyup' && e.code!=='Space')return;record.endStarted=performance.now();obs.disconnect();svg.remove();record.overlayRemoved=performance.now();style.remove();record.originalsEnabled=performance.now();requestAnimationFrame(()=>{record.firstFrameCallback=performance.now();requestAnimationFrame(()=>{record.secondFrameCallback=performance.now()})});record.end=e.type;for(const type of events)window.removeEventListener(type,end,true);document.removeEventListener('visibilitychange',hide)}
    function hide(){if(document.hidden)end({type:'visibilitychange'})}
    for(const type of events)window.addEventListener(type,end,true);document.addEventListener('visibilitychange',hide)
  },true)
}
