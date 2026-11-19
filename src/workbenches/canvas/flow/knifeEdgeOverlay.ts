import type { snapshotEdges } from './knifeSnapshot'
import { knifeFragment, knifeVertex } from './knifeEdgeShaders'

export interface KnifeEdgeOverlay { draw(cut: ReadonlySet<string>): void; dispose(): void }

/** Only a single uniform RF viewport of ordinary cubic edges can be substituted.
 * The original DOM remains authoritative for picking, undo, controls and fallback. */
export function createKnifeEdgeOverlay(surface: HTMLElement, edges: ReturnType<typeof snapshotEdges>): KnifeEdgeOverlay | null {
  if (edges.length < 200) return null
  const first = edges[0]!, layer = first.path.closest<HTMLElement>('.react-flow__edges')
  const viewport = layer?.closest('.react-flow'), m = first.matrix
  if (!layer || !viewport || !surface.contains(layer) || m.a <= 0 || m.a !== m.d || m.b || m.c) return null
  const coords: number[] = [], attrs: number[] = [], palette = new Map<string, number[]>()
  const pixel = document.createElement('canvas').getContext('2d')
  if (!pixel) return null
  for (const { path, matrix } of edges) {
    if (!layer.contains(path) || matrix.a !== m.a || matrix.d !== m.d || matrix.e !== m.e || matrix.f !== m.f || matrix.b || matrix.c) return null
    const d = path.getAttribute('d') ?? ''
    if (d.replace(/[-+]?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?|[\s,]/gi,'') !== 'MC') return null
    const values = d.match(/[-+]?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?/gi)?.map(Number)
    if (values?.length !== 8 || !values.every(Number.isFinite)) return null
    coords.push(...values)
    const key = path.getAttribute('class') ?? ''
    if (!palette.has(key)) {
      const css=getComputedStyle(path); pixel.clearRect(0,0,1,1);pixel.fillStyle=css.stroke;pixel.fillRect(0,0,1,1)
      palette.set(key,[...Array.from(pixel.getImageData(0,0,1,1).data,v=>v/255),parseFloat(css.strokeWidth)])
    }
    attrs.push(...palette.get(key)!)
  }
  const canvas=document.createElement('canvas'), r=viewport.getBoundingClientRect(), dpr=Math.min(devicePixelRatio,2)
  canvas.setAttribute('aria-hidden','true');canvas.dataset.knifeEdgeOverlay=''
  canvas.width=Math.ceil(r.width*dpr);canvas.height=Math.ceil(r.height*dpr)
  Object.assign(canvas.style,{position:'absolute',pointerEvents:'none',left:`${(r.left-m.e)/m.a}px`,top:`${(r.top-m.f)/m.d}px`,width:`${r.width/m.a}px`,height:`${r.height/m.d}px`})
  const gl=canvas.getContext('webgl2',{alpha:true,antialias:true,depth:false,stencil:false})
  if (!gl) return null
  let disposed=false
  function dispose(){if(disposed)return;disposed=true;layer?.removeAttribute('data-knife-gpu');canvas.remove();canvas.removeEventListener('webglcontextlost',dispose);gl?.getExtension('WEBGL_lose_context')?.loseContext()}
  try {
    const program=gl.createProgram()!
    for(const [kind,src] of [[gl.VERTEX_SHADER,knifeVertex],[gl.FRAGMENT_SHADER,knifeFragment]] as const){const shader=gl.createShader(kind)!;gl.shaderSource(shader,src);gl.compileShader(shader);gl.attachShader(program,shader)}
    gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('link');gl.useProgram(program)
    const loc=(k:string)=>gl.getUniformLocation(program,k)
    gl.uniform4f(loc('mapping'),m.a,m.d,m.e-r.left,m.f-r.top);gl.uniform2f(loc('size'),r.width,r.height)
    const buffer=(data:Float32Array,usage:number)=>{gl.bindBuffer(gl.ARRAY_BUFFER,gl.createBuffer());gl.bufferData(gl.ARRAY_BUFFER,data,usage)}
    const attr=(i:number,n:number,stride:number,off:number)=>{gl.vertexAttribPointer(i,n,gl.FLOAT,false,stride,off);gl.enableVertexAttribArray(i);gl.vertexAttribDivisor(i,1)}
    buffer(new Float32Array(coords),gl.STATIC_DRAW);attr(0,4,32,0);attr(1,4,32,16)
    buffer(new Float32Array(attrs),gl.STATIC_DRAW);attr(3,4,20,0);attr(4,1,20,16)
    const alive=new Float32Array(edges.length);buffer(alive,gl.DYNAMIC_DRAW);attr(2,1,0,0)
    canvas.addEventListener('webglcontextlost',dispose)
    return {dispose,draw(cut){if(disposed)return;edges.forEach(({id},i)=>{alive[i]=cut.has(id)?0:1});gl.bufferSubData(gl.ARRAY_BUFFER,0,alive);gl.clear(gl.COLOR_BUFFER_BIT);gl.drawArraysInstanced(gl.TRIANGLE_STRIP,0,130,edges.length);if(gl.getError()!==gl.NO_ERROR||gl.isContextLost()){dispose();return}if(!canvas.isConnected){layer.before(canvas);layer.setAttribute('data-knife-gpu','')}}}
  }catch{dispose();return null}
}
