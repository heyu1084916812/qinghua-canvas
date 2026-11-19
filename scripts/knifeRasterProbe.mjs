// Diagnostic release-page renderer for the frozen, unselected real-photo fixture.
export function installKnifeRasterProbe(){
  window.knifeBatchEvidence=[]
  window.addEventListener('pointerdown',()=>{
    if(!document.querySelector('[data-knife-cursor]'))return
    const layer=document.querySelector('.react-flow__edges'), originals=[...layer.querySelectorAll('[data-edge]')]
    if(!originals.length)return
    const parent=layer.parentElement, first=originals[0], matrix=first.getScreenCTM(), zoom=matrix.a
    const rect=parent.closest('.react-flow').getBoundingClientRect(), scale=window.devicePixelRatio
    const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');canvas.dataset.knifeRaster=''
    Object.assign(canvas.style,{position:'absolute',pointerEvents:'none',left:`${(rect.left-matrix.e)/zoom}px`,top:`${(rect.top-matrix.f)/zoom}px`,width:`${rect.width/zoom}px`,height:`${rect.height/zoom}px`})
    const style=document.createElement('style');style.textContent='.react-flow__edges{visibility:hidden!important}'
    const paths=new Map(originals.map(p=>[p,new Path2D(p.getAttribute('d'))])),ink=getComputedStyle(first),color=ink.stroke,width=parseFloat(ink.strokeWidth)
    const record={initial:paths.size,minimum:paths.size,updates:0,visible:true,activated:false};window.knifeBatchEvidence.push(record)
    const obs=new MutationObserver(records=>{
      for(const {target} of records)if(target.hasAttribute('data-knife-pending'))paths.delete(target)
      if(!record.activated){canvas.width=Math.ceil(rect.width*scale);canvas.height=Math.ceil(rect.height*scale);layer.before(canvas);document.head.append(style);record.activated=true}
      ctx.resetTransform();ctx.clearRect(0,0,canvas.width,canvas.height);ctx.setTransform(scale*zoom,0,0,scale*zoom,scale*(matrix.e-rect.left),scale*(matrix.f-rect.top));ctx.strokeStyle=color;ctx.lineWidth=width/zoom
      for(const path of paths.values())ctx.stroke(path)
      record.minimum=Math.min(record.minimum,paths.size);record.updates++
    });obs.observe(layer,{subtree:true,attributes:true,attributeFilter:['data-knife-pending']})
    const types=['pointerup','pointercancel','blur','keyup'];function end(e){if(e.type==='keyup'&&e.code!=='Space')return;obs.disconnect();canvas.remove();style.remove();record.end=e.type;for(const t of types)window.removeEventListener(t,end,true);document.removeEventListener('visibilitychange',hide)}
    function hide(){if(document.hidden)end({type:'visibilitychange'})}for(const t of types)window.addEventListener(t,end,true);document.addEventListener('visibilitychange',hide)
  },true)
}
