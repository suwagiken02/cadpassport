// ============================================================
// 下図の画像の使い回し (= U-1)・DOM を知らない小さな LRU
//
// ■ なぜ要るか
// 画像は Blob URL（URL.createObjectURL）で表示する。作りっぱなしにすると
// **ページを切り替えるたびに数 MB ずつメモリが積み上がる**ので、使わなくなった
// ものは必ず revoke する。一方で毎回ダウンロードし直すのも遅いので、
// 直近のぶんは取っておいて使い回す。
//
// ここは「どれを取っておき、どれを捨てるか」の帳簿だけを持つ。実際の
// createObjectURL / revokeObjectURL は呼び出し側から渡す（node でテストできる）。
// ============================================================

/** 取っておく枚数。ページを行き来しても取り直さない程度に、かつメモリを食わない程度に。 */
export const UNDERLAY_CACHE_SIZE = 3;

export type CacheEntry<T> = { key: string; value: T };

/**
 * 使った順に並べ、あふれたら古いものから捨てる入れ物。
 * 捨てるときに onEvict を呼ぶので、呼び出し側で revokeObjectURL できる。
 */
export class LruCache<T> {
  private map = new Map<string, T>();

  constructor(
    private readonly capacity: number,
    private readonly onEvict: (key: string, value: T) => void,
  ) {}

  /** 取り出す（あれば「最近使った」扱いに更新する）。 */
  get(key: string): T | undefined {
    if (!this.map.has(key)) return undefined;
    const v = this.map.get(key)!;
    // 入れ直して末尾（＝最近使った側）へ移す
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  /** 入れる。同じキーが既にあれば、古い方を捨ててから入れ替える。 */
  set(key: string, value: T): void {
    const old = this.map.get(key);
    if (old !== undefined) {
      this.map.delete(key);
      if (old !== value) this.onEvict(key, old);
    }
    this.map.set(key, value);
    // あふれたぶんを古い順に捨てる
    while (this.map.size > this.capacity) {
      const k = Array.from(this.map.keys())[0];
      if (k === undefined) break;
      const v = this.map.get(k)!;
      this.map.delete(k);
      this.onEvict(k, v);
    }
  }

  /** 1 つ捨てる（画像を差し替えたときなど）。 */
  delete(key: string): void {
    const v = this.map.get(key);
    if (v === undefined) return;
    this.map.delete(key);
    this.onEvict(key, v);
  }

  /** 全部捨てる（作図画面を離れるとき）。 */
  clear(): void {
    for (const k of Array.from(this.map.keys())) this.onEvict(k, this.map.get(k)!);
    this.map.clear();
  }

  /** いま持っているキー（古い順）。テストと診断用。 */
  keys(): string[] {
    return Array.from(this.map.keys());
  }

  get size(): number {
    return this.map.size;
  }
}

/** 取得の状態。画面の出し分けに使う。 */
export type UnderlayLoadStatus = 'idle' | 'loading' | 'ready' | 'error';
