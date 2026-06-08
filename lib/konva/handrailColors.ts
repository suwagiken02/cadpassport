import { HandrailLengthMm, INCH_ALL_HANDRAIL_SIZES } from '@/types';

/** 手摺の長さごとの色。
 *  インチ規格の長さは対応するメートル兄弟と同色にする
 *  (1829↔1800 / 1524↔1500 / 1219↔1200 / 914↔900 / 610↔600 / 410↔400 / 305↔300 / 200↔200)。*/
export const HANDRAIL_COLORS: Record<HandrailLengthMm, string> = {
  // メートル規格
  1800: '#60a5fa',
  1500: '#22d3ee',
  1200: '#4ade80',
  1000: '#a3e635',
   900: '#facc15',
   800: '#fb7185',
   600: '#fb923c',
   500: '#ef4444',
   400: '#f87171',
   300: '#c084fc',
   200: '#f472b6',
   150: '#e879f9',
   100: '#94a3b8',
  // インチ規格（メートル兄弟と同色）
  1829: '#60a5fa',
  1524: '#22d3ee',
  1219: '#4ade80',
   914: '#facc15',
   610: '#fb923c',
   410: '#f87171',
   305: '#c084fc',
};

/** 手摺の長さから色を取得（未定義なら青フォールバック） */
export function getHandrailColor(lengthMm: HandrailLengthMm): string {
  return HANDRAIL_COLORS[lengthMm] ?? '#185FA5';
}

/** 凡例用の長さリスト（メートル規格・降順） */
export const HANDRAIL_LEGEND: { lengthMm: HandrailLengthMm; color: string }[] = [
  { lengthMm: 1800, color: '#60a5fa' },
  { lengthMm: 1500, color: '#22d3ee' },
  { lengthMm: 1200, color: '#4ade80' },
  { lengthMm: 1000, color: '#a3e635' },
  { lengthMm:  900, color: '#facc15' },
  { lengthMm:  800, color: '#fb7185' },
  { lengthMm:  600, color: '#fb923c' },
  { lengthMm:  500, color: '#ef4444' },
  { lengthMm:  400, color: '#f87171' },
  { lengthMm:  300, color: '#c084fc' },
  { lengthMm:  200, color: '#f472b6' },
  { lengthMm:  150, color: '#e879f9' },
  { lengthMm:  100, color: '#94a3b8' },
];

/** 凡例用の長さリスト（インチ規格・降順） */
export const INCH_HANDRAIL_LEGEND: { lengthMm: HandrailLengthMm; color: string }[] =
  INCH_ALL_HANDRAIL_SIZES.map((lengthMm) => ({ lengthMm, color: getHandrailColor(lengthMm) }));

/** 規格別の凡例リストを取得（最小変更で規格別に引けるようにするヘルパ）。*/
export function getHandrailLegend(
  unitSystem: 'metric' | 'inch' = 'metric',
): { lengthMm: HandrailLengthMm; color: string }[] {
  return unitSystem === 'inch' ? INCH_HANDRAIL_LEGEND : HANDRAIL_LEGEND;
}
