// Release-page experiment only. A frozen viewport and unselected benchmark graph.
export function installKnifeBatchProbe(chunkSize) {
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
    const chunks=[]
    for(let i=0;i<data.length;i+=chunkSize){const path=i===0?merged:merged.cloneNode(false);if(i)group.append(path);chunks.push({path,edges:data.slice(i,i+chunkSize),previous:-1})}
    const refresh=()=>{let count=0;for(const chunk of chunks){const alive=chunk.edges.filter(([p])=>p.isConnected&&!p.hasAttribute('data-knife-pending'));count+=alive.length;if(alive.length!==chunk.previous){chunk.path.setAttribute('d',alive.map(([,d])=>d).join(' '));chunk.previous=alive.length}}record.minimum=Math.min(record.minimum,count);record.updates++}
    refresh();const parent=first.ownerSVGElement.parentElement;parent.insertBefore(svg,first.ownerSVGElement)
    const style=document.createElement('style');style.textContent='.react-flow__edges{visibility:hidden!important}';svg.classList.remove('react-flow__edges');document.head.append(style)
    record.visible=getComputedStyle(merged).visibility==='visible' && getComputedStyle(merged).stroke!=='none' && merged.getBoundingClientRect().width>0;
    const obs=new MutationObserver(refresh);obs.observe(parent,{attributes:true,subtree:true,attributeFilter:['data-knife-pending']})
    window.addEventListener('pointerup',()=>{refresh();obs.disconnect();style.remove();svg.remove()},{once:true,capture:true})
  },true)
}
