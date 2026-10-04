/** 轴配置切片的公开出口（含分区判定） */
export {
  defaultAxisConfig,
  isValidRegion,
  type AxisConfig,
  type AxisConfigId,
  type ZoneId,
  type ZoneRegion,
} from "./model";
export { regionById, resolveZone, resolveZones } from "./zone";
