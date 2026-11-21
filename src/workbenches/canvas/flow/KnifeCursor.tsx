/**
 * 美工刀改为原生 CSS cursor 后，保留这个不可见锚点给现有探针和冒烟定位工具状态。
 * 它不跟随指针、不参与绘制，也不影响系统光标。
 */
export function KnifeCursor({ active }: { active: boolean }) {
  return active ? <span data-knife-cursor data-native-knife-cursor hidden aria-hidden /> : null
}
