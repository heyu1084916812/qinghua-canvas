import type { ScreenPoint } from './edgeCutGeometry'

/** RF 普通/粗略边均由一个 M + C 构成。复用实际绘制的控制点，不重复调用昂贵的 SVG 长度 API。 */
export function snapshotEdges(surface: HTMLElement, rect: DOMRect) {
  return Array.from(surface.querySelectorAll<SVGPathElement>('[data-edge]')).flatMap(path => {
    const id = path.dataset.edge, d = path.getAttribute('d') ?? '', matrix = path.getScreenCTM()
    if (!id || !matrix) return []
    const nums = d.match(/[-+]?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?/gi)?.map(Number)
    const pts: ScreenPoint[] = []
    const add = (x: number, y: number) => pts.push({ x: matrix.a*x + matrix.c*y + matrix.e - rect.left, y: matrix.b*x + matrix.d*y + matrix.f - rect.top })
    if (nums?.length === 8 && /^M[^a-z]*C/i.test(d.replace(/e[-+]?\d+/gi,''))) {
      for (let i=0;i<=20;i++) {
        const t=i/20, u=1-t, blend=(a:number,b:number,c:number,d:number)=>u*u*u*a+3*u*u*t*b+3*u*t*t*c+t*t*t*d
        add(blend(nums[0]!,nums[2]!,nums[4]!,nums[6]!),blend(nums[1]!,nums[3]!,nums[5]!,nums[7]!))
      }
    } else {
      const len=path.getTotalLength(); if (!(len>0)) return []
      for(let i=0;i<=20;i++){const p=path.getPointAtLength(i*len/20);add(p.x,p.y)}
    }
    const xs=pts.map(p=>p.x), ys=pts.map(p=>p.y)
    return [{ id, path, matrix, points:pts, box:{minX:Math.min(...xs),maxX:Math.max(...xs),minY:Math.min(...ys),maxY:Math.max(...ys)} }]
  })
}
