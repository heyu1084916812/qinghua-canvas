// Diagnostic for a single-style fixture, not a replacement for the product's SVG renderer.
export function installKnifeGpuProbe(forceUnavailable=false){
  window.knifeBatchEvidence=[]
  window.addEventListener('pointerdown',()=>{
    if(!document.querySelector('[data-knife-cursor]'))return
    const layer=document.querySelector('.react-flow__edges'), edges=[...layer.querySelectorAll('[data-edge]')];if(!edges.length)return
    const mat=edges[0].getScreenCTM(),z=mat.a,r=layer.closest('.react-flow').getBoundingClientRect(),dpr=devicePixelRatio
    const c=document.createElement('canvas'),style=document.createElement('style');style.textContent='.react-flow__edges{visibility:hidden!important}'
    const rec={initial:edges.length,minimum:edges.length,updates:0,visible:true,activated:false};window.knifeBatchEvidence.push(rec)
    const ids=new Map(edges.map((p,i)=>[p,i])),alive=new Float32Array(edges.length).fill(1);let gl,buffer,failed=false
    function fallback(reason){failed=true;rec.fallback=reason;c.remove();style.remove()}
    c.addEventListener('webglcontextlost',()=>{if(!rec.end)fallback('context-lost')})
    function activate(){
      const ink=getComputedStyle(edges[0]),color=ink.stroke,width=parseFloat(ink.strokeWidth);const pixel=document.createElement('canvas').getContext('2d');pixel.fillStyle=color;pixel.fillRect(0,0,1,1);const rgba=pixel.getImageData(0,0,1,1).data
      Object.assign(c.style,{position:'absolute',pointerEvents:'none',left:`${(r.left-mat.e)/z}px`,top:`${(r.top-mat.f)/z}px`,width:`${r.width/z}px`,height:`${r.height/z}px`});c.width=Math.ceil(r.width*dpr);c.height=Math.ceil(r.height*dpr)
      gl=!forceUnavailable && c.getContext('webgl2',{alpha:true,antialias:true,depth:false,stencil:false});if(!gl)throw Error('WebGL2 unavailable')
      const pr=gl.createProgram();function shader(kind,src){const s=gl.createShader(kind);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));gl.attachShader(pr,s)}
      shader(gl.VERTEX_SHADER,`#version 300 es
      layout(location=0) in vec4 ab;layout(location=1) in vec4 cd;layout(location=2) in float alive;
      uniform vec4 mapping;uniform vec2 size;uniform float width;
      void main(){float t=float(gl_VertexID/2)/64.,u=1.-t;vec2 a=ab.xy,b=ab.zw,c=cd.xy,d=cd.zw;
      vec2 p=u*u*u*a+3.*u*u*t*b+3.*u*t*t*c+t*t*t*d;vec2 tangent=u*u*(b-a)+2.*u*t*(c-b)+t*t*(d-c);vec2 n=vec2(-tangent.y,tangent.x)/max(length(tangent),.0001);
      vec2 v=((p*mapping.xy+mapping.zw)+n*width*(float(gl_VertexID%2)-.5))/size;
      gl_Position=alive==0.?vec4(2.,2.,0.,1.):vec4(v.x*2.-1.,1.-v.y*2.,0.,1.);}`)
      shader(gl.FRAGMENT_SHADER,`#version 300 es
      precision mediump float;uniform vec4 color;out vec4 outColor;void main(){outColor=color;}`);gl.linkProgram(pr);if(!gl.getProgramParameter(pr,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(pr));gl.useProgram(pr)
      const loc=k=>gl.getUniformLocation(pr,k);gl.uniform4f(loc('mapping'),z,mat.d,mat.e-r.left,mat.f-r.top);gl.uniform2f(loc('size'),r.width,r.height);gl.uniform1f(loc('width'),width);gl.uniform4fv(loc('color'),Float32Array.from(rgba,v=>v/255));
      const coords=new Float32Array(edges.flatMap(p=>{const a=p.getAttribute('d').match(/[-+]?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?/gi).map(Number);if(a.length!==8)throw Error('expected cubic');return a}));
      gl.bindBuffer(gl.ARRAY_BUFFER,gl.createBuffer());gl.bufferData(gl.ARRAY_BUFFER,coords,gl.STATIC_DRAW);for(let i=0;i<2;i++){gl.vertexAttribPointer(i,4,gl.FLOAT,false,32,16*i);gl.enableVertexAttribArray(i);gl.vertexAttribDivisor(i,1)}
      buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,alive,gl.DYNAMIC_DRAW);gl.vertexAttribPointer(2,1,gl.FLOAT,false,0,0);gl.enableVertexAttribArray(2);gl.vertexAttribDivisor(2,1);layer.before(c);document.head.append(style);rec.activated=true
    }
    let live=edges.length;const obs=new MutationObserver(records=>{if(!rec.activated&&!failed){try{activate()}catch(err){fallback(String(err))}}for(const m of records){const i=ids.get(m.target);if(alive[i]&&m.target.hasAttribute('data-knife-pending')){alive[i]=0;live--}}if(failed){rec.minimum=Math.min(rec.minimum,live);return}gl.bufferSubData(gl.ARRAY_BUFFER,0,alive);gl.clear(gl.COLOR_BUFFER_BIT);gl.drawArraysInstanced(gl.TRIANGLE_STRIP,0,130,edges.length);if(gl.getError()!==gl.NO_ERROR)throw Error('draw failed');if(window.knifeCheckPixels && live>0 && live<300 && !rec.pixelCheck){
      const id=alive.findIndex(v=>v===1),path=edges[id],point=path.getPointAtLength(path.getTotalLength()/2).matrixTransform(path.getScreenCTM()),box=c.getBoundingClientRect();const x=Math.round((point.x-box.left)*c.width/box.width),y=c.height-1-Math.round((point.y-box.top)*c.height/box.height),sample=new Uint8Array(100);gl.readPixels(x-2,y-2,5,5,gl.RGBA,gl.UNSIGNED_BYTE,sample);rec.pixelCheck={edge:path.dataset.edge,x,y,maxAlpha:Math.max(...sample.filter((_,i)=>i%4===3))};
    }rec.updates++;rec.minimum=Math.min(rec.minimum,live)})
    obs.observe(layer,{subtree:true,attributes:true,attributeFilter:['data-knife-pending']});const types=['pointerup','pointercancel','blur','keyup'];function end(e){if(e.type==='keyup'&&e.code!=='Space')return;obs.disconnect();c.remove();style.remove();if(gl)gl.getExtension('WEBGL_lose_context')?.loseContext();rec.end=e.type;for(const t of types)window.removeEventListener(t,end,true);document.removeEventListener('visibilitychange',hide)}function hide(){if(document.hidden)end({type:'visibilitychange'})}for(const t of types)window.addEventListener(t,end,true);document.addEventListener('visibilitychange',hide)
  },true)
}
