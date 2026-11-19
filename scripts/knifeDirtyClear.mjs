// Diagnostic only: limit the clear to the previous trail/sparks' bounding box.
// The production painter uses moveTo/lineTo (round strokes up to 9px) and arc.
export function installKnifeDirtyClear() {
  const proto=CanvasRenderingContext2D.prototype, boxes=new WeakMap()
  const interested=ctx=>ctx.canvas.hasAttribute('data-knife-fx')
  for(const name of ['moveTo','lineTo','arc']){
    const original=proto[name];proto[name]=function(x,y,...args){
      if(interested(this)){
        const pad=name==='arc'?Math.abs(args[0])+2:8
        const b=boxes.get(this)??[Infinity,Infinity,-Infinity,-Infinity]
        b[0]=Math.min(b[0],Math.floor(x-pad));b[1]=Math.min(b[1],Math.floor(y-pad));b[2]=Math.max(b[2],Math.ceil(x+pad));b[3]=Math.max(b[3],Math.ceil(y+pad));boxes.set(this,b)
      }
      return original.call(this,x,y,...args)
    }
  }
  const clear=proto.clearRect
  proto.clearRect=function(...args){if(!interested(this))return clear.apply(this,args);const b=boxes.get(this);boxes.delete(this);if(b)return clear.call(this,b[0],b[1],b[2]-b[0],b[3]-b[1])}
}
