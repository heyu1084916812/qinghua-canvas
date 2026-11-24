// Test-page-only observation of the original product calls, scoped to one stroke.
export function watchPartialStroke(){
  const report={reads:0,added:0,removed:0,rects:[],queries:[],sample:[],events:[]},undo=[]
  function wrap(proto,key,after){const original=proto[key];proto[key]=function(...args){const value=original.apply(this,args);after(this,args,value);return value};undo.push(()=>{proto[key]=original})}
  wrap(Element.prototype,'querySelectorAll',(el,args,nodes)=>{if(args[0]==='[data-edge]' && el.hasAttribute('data-canvas-surface'))report.queries.push({count:nodes.length,documentEdges:document.querySelectorAll('[data-edge]').length,groups:el.querySelectorAll('.react-flow__edge').length,connected:el.isConnected,at:performance.now()})})
  wrap(SVGGraphicsElement.prototype,'getScreenCTM',(p,_,m)=>{if(!p.matches('[data-edge]'))return;report.reads++;if(report.sample.length<4)report.sample.push({id:p.dataset.edge,d:p.getAttribute('d'),matrix:m&&[m.a,m.b,m.c,m.d,m.e,m.f]})})
  wrap(Element.prototype,'getBoundingClientRect',(p,_,r)=>{if(p.matches('[data-canvas-surface]'))report.rects.push([r.x,r.y,r.width,r.height])})
  wrap(Element.prototype,'setAttribute',(_,args)=>{if(args[0]==='data-knife-pending')report.added++})
  wrap(Element.prototype,'removeAttribute',(_,args)=>{if(args[0]==='data-knife-pending')report.removed++})
  const capture=e=>report.events.push({t:e.type,x:e.clientX,y:e.clientY,knife:!!document.querySelector('[data-knife-cursor]'),target:e.target?.tagName,at:performance.now()});for(const t of ['pointerdown','pointermove','pointerup','blur','pointercancel','visibilitychange']){window.addEventListener(t,capture,true);undo.push(()=>window.removeEventListener(t,capture,true))}
  window.finishPartial=()=>{for(const fn of undo.reverse())fn();return report}
}
