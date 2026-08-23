/**
 * 农历信息封装（基于 lunar-javascript，覆盖 1900-2100）
 *
 * 提供：农历月日、节气、传统节日、干支、生肖，供日历系统使用。
 */
import { Lunar } from 'lunar-javascript';

/** 某天的农历信息 */
export interface LunarDayInfo {
  /** 农历日（初一、初二…三十） */
  lunarDay: string;
  /** 农历月（正月、二月…腊月） */
  lunarMonth: string;
  /** 农历月+日（如「七月十一」，除夕等特殊显示） */
  lunarFull: string;
  /** 节气名（当天是二十四节气之一时非空，否则空串） */
  jieQi: string;
  /** 传统节日列表（如 除夕、中秋、国庆…） */
  festivals: string[];
  /** 干支年（如 丙午） */
  ganZhi: string;
  /** 生肖（如 马） */
  shengXiao: string;
}

/**
 * 获取某天的农历信息
 *
 * @param date 公历日期
 */
export function getDayInfo(date: Date): LunarDayInfo {
  const lunar = Lunar.fromDate(date);
  const lunarMonth = lunar.getMonthInChinese();
  const lunarDay = lunar.getDayInChinese();
  return {
    lunarDay,
    lunarMonth,
    lunarFull: `${lunarMonth}月${lunarDay}`,
    jieQi: lunar.getJieQi() || '',
    festivals: lunar.getFestivals(),
    ganZhi: lunar.getYearInGanZhi(),
    shengXiao: lunar.getYearShengXiao(),
  };
}

/**
 * 农历月日 → 指定年份的公历日期
 *
 * @param lunarDate 农历月日："MM-DD"（如 08-15）；闰月前缀负号 "-MM-DD"
 * @param year 公历年份（农历日期属于该农历年）
 * @returns 公历 Date；该年无此农历日（如当年无该闰月）返回 null
 */
export function lunarToSolar(lunarDate: string, year: number): Date | null {
  const m = lunarDate.match(/^(-)?(\d{2})-(\d{2})$/);
  if (!m) return null;
  const leap = m[1] === '-';
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 30) return null;
  try {
    const lunar = Lunar.fromYmd(year, leap ? -month : month, day);
    const solar = lunar.getSolar();
    return new Date(solar.getYear(), solar.getMonth() - 1, solar.getDay());
  } catch {
    // 该年无此农历月日（如当年无对应闰月）
    return null;
  }
}
