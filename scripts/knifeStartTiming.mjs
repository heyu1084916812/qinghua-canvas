// Runs before the knife test; Event Timing reports the browser's own dispatch
// boundaries, including handlers which stop propagation. No DOM changes.
export function installKnifeStartTiming(){
  window.knifeStartTiming={events:[],matrices:[]}
  const obs=new PerformanceObserver(list=>{for(const e of list.getEntries())if(e.name==='pointerdown')window.knifeStartTiming.events.push({start:e.startTime,processingStart:e.processingStart,processingEnd:e.processingEnd,duration:e.duration})});obs.observe({type:'event',durationThreshold:16})
  const fn=SVGGraphicsElement.prototype.getScreenCTM
  SVGGraphicsElement.prototype.getScreenCTM=function(){if(!this.hasAttribute('data-edge'))return fn.call(this);const a=performance.now();const m=fn.call(this);const b=performance.now();let group=window.knifeStartTiming.matrices.at(-1);if(!group||a-group.end>15){group={start:a,end:b,ms:0,n:0};window.knifeStartTiming.matrices.push(group)}group.end=b;group.ms+=b-a;group.n++;return m}
}
