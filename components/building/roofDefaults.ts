// 屋根まわりのデフォルト値（R-1a）。純 .ts なので JSX を含まず、テストからも直接 import 可能。
import type { RoofShape } from './RoofShapeSelector';

/** 新規建物のデフォルト屋根形状（R-1a: 寄棟→切妻）。実建築で最頻・棟を自動生成しない形状。
 *  BuildingTemplateModal / RoofSettingsModal はこの単一ソースを参照する。 */
export const DEFAULT_ROOF_SHAPE: RoofShape = 'gable';
