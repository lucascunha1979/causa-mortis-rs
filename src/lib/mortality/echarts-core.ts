import * as echarts from "echarts/core";
import type {
  BarSeriesOption,
  LineSeriesOption,
  LinesSeriesOption,
  MapSeriesOption,
  PieSeriesOption,
  ScatterSeriesOption,
  TreemapSeriesOption,
} from "echarts/charts";
import type {
  GeoComponentOption,
  GridComponentOption,
  LegendComponentOption,
  MarkAreaComponentOption,
  MarkLineComponentOption,
  TooltipComponentOption,
  VisualMapComponentOption,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { ComposeOption } from "echarts/core";
import type {
  CallbackDataParams,
  TopLevelFormatterParams,
} from "echarts/types/dist/shared";

echarts.use([CanvasRenderer]);

export { echarts };
export type { ECElementEvent, EChartsType } from "echarts/core";
export type { CallbackDataParams, LineSeriesOption, TopLevelFormatterParams };

export type EChartsOption = ComposeOption<
  | BarSeriesOption
  | LineSeriesOption
  | LinesSeriesOption
  | MapSeriesOption
  | PieSeriesOption
  | ScatterSeriesOption
  | TreemapSeriesOption
  | GeoComponentOption
  | GridComponentOption
  | LegendComponentOption
  | MarkAreaComponentOption
  | MarkLineComponentOption
  | TooltipComponentOption
  | VisualMapComponentOption
>;
