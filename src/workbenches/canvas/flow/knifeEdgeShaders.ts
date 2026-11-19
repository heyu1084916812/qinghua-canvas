export const knifeVertex = `#version 300 es
      layout(location=0) in vec4 ab;layout(location=1) in vec4 cd;layout(location=2) in float alive;
      layout(location=3) in vec4 ink;layout(location=4) in float width;flat out vec4 color;uniform vec4 mapping;uniform vec2 size;
      void main(){color=ink;float t=float(gl_VertexID/2)/64.,u=1.-t;vec2 a=ab.xy,b=ab.zw,c=cd.xy,d=cd.zw;
      vec2 p=u*u*u*a+3.*u*u*t*b+3.*u*t*t*c+t*t*t*d;vec2 tangent=u*u*(b-a)+2.*u*t*(c-b)+t*t*(d-c);vec2 n=vec2(-tangent.y,tangent.x)/max(length(tangent),.0001);
      vec2 v=((p*mapping.xy+mapping.zw)+n*width*(float(gl_VertexID%2)-.5))/size;
      gl_Position=alive==0.?vec4(2.,2.,0.,1.):vec4(v.x*2.-1.,1.-v.y*2.,0.,1.);}`
export const knifeFragment = `#version 300 es
      precision highp float;flat in vec4 color;out vec4 outColor;void main(){outColor=color;}`
