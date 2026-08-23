/**
 * lunar-javascript 类型声明（库未内置 d.ts）
 * 仅声明本项目用到的方法，未用到的保持宽泛。
 */
declare module 'lunar-javascript' {
  export class Lunar {
    /** 由公历日期构造（取本地年月日） */
    static fromDate(date: Date): Lunar;
    /** 由农历年月日构造（闰月传负月，如 2026, -7, 3） */
    static fromYmd(lunarYear: number, lunarMonth: number, lunarDay: number): Lunar;
    getYear(): number;
    getMonth(): number;
    getDay(): number;
    getYearInChinese(): string;
    getMonthInChinese(): string;
    getDayInChinese(): string;
    /** 节气名（非节气日返回空串） */
    getJieQi(): string;
    /** 传统节日列表 */
    getFestivals(): string[];
    getYearInGanZhi(): string;
    getYearShengXiao(): string;
    getDayYi(): string[];
    getDayJi(): string[];
    /** 转公历 */
    getSolar(): Solar;
  }

  export class Solar {
    getYear(): number;
    getMonth(): number;
    getDay(): number;
  }
  export const LunarUtil: unknown;
  export const SolarUtil: unknown;
}
