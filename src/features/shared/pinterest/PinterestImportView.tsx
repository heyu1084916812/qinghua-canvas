import type {
  PinterestBoard,
  PinterestPin,
} from '../../../domain/inspiration/pinterest'
import styles from './PinterestPanel.module.css'

export interface PinterestImportViewProps {
  busy: string
  boards: readonly PinterestBoard[]
  selectedBoards: ReadonlySet<string>
  pins: readonly PinterestPin[]
  selectedPins: ReadonlySet<string>
  selectedPinCount: number
  canvasReady: boolean
  onBoards: (value: Set<string>) => void
  onPins: (value: Set<string>) => void
  onLoadBoards: () => void
  onLoadPins: () => void
  onImportLibrary: () => void
  onImportCanvas: () => void
}

export function PinterestImportView(props: PinterestImportViewProps) {
  return (
    <>
      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.secondary}
          disabled={Boolean(props.busy)}
          onClick={props.onLoadBoards}
        >
          {props.busy === 'boards' ? '读取中…' : '读取收藏板'}
        </button>
        <button
          type="button"
          className={styles.secondary}
          disabled={Boolean(props.busy) || props.selectedBoards.size === 0}
          onClick={props.onLoadPins}
        >
          {props.busy === 'pins' ? '读取中…' : '读取所选收藏'}
        </button>
        <span>{props.selectedPinCount} 张已选</span>
      </div>

      {props.boards.length > 0 ? (
        <div className={styles.boards} aria-label="Pinterest 收藏板">
          {props.boards.map((board) => (
            <label key={board.id} className={styles.board}>
              <input
                type="checkbox"
                checked={props.selectedBoards.has(board.id)}
                onChange={() => {
                  const next = new Set(props.selectedBoards)
                  if (next.has(board.id)) next.delete(board.id)
                  else next.add(board.id)
                  props.onBoards(next)
                }}
              />
              <span>{board.name}</span>
              {board.pinCount !== undefined ? <small>{board.pinCount}</small> : null}
            </label>
          ))}
        </div>
      ) : null}

      {props.pins.length > 0 ? (
        <>
          <div className={styles.pinActions}>
            <button
              type="button"
              className={styles.secondary}
              disabled={Boolean(props.busy)}
              onClick={() =>
                props.onPins(
                  new Set(
                    props.pins
                      .filter((pin) => pin.imageUrl)
                      .map((pin) => pin.id),
                  ),
                )
              }
            >
              全选
            </button>
            <button
              type="button"
              className={styles.secondary}
              disabled={Boolean(props.busy) || props.selectedPinCount === 0}
              onClick={props.onImportLibrary}
            >
              保存到素材库
            </button>
            <button
              type="button"
              className={styles.primary}
              disabled={
                Boolean(props.busy) ||
                props.selectedPinCount === 0 ||
                !props.canvasReady
              }
              title={props.canvasReady ? undefined : '先打开一个画布项目'}
              onClick={props.onImportCanvas}
            >
              保存并导入画布
            </button>
          </div>
          <div className={styles.grid}>
            {props.pins.map((pin) => (
              <button
                key={pin.id}
                type="button"
                className={
                  props.selectedPins.has(pin.id)
                    ? `${styles.pin} ${styles.pinSelected}`
                    : styles.pin
                }
                onClick={() => {
                  const next = new Set(props.selectedPins)
                  if (next.has(pin.id)) next.delete(pin.id)
                  else next.add(pin.id)
                  props.onPins(next)
                }}
              >
                {pin.imageUrl ? <img src={pin.imageUrl} alt="" loading="lazy" /> : null}
                <span>{pin.title}</span>
              </button>
            ))}
          </div>
        </>
      ) : null}
    </>
  )
}
