let configuredTimeZone: string | undefined;
let configuredLocale: string | undefined;

/** 时间格式跟随界面语言，而不是系统区域（否则中文界面里会出现 26/10/2026）。 */
export function configureUserLocale(value?: string): void {
  configuredLocale = value;
}

/** 设置从 agents.defaults.timezone 读取的用户时区。 */
export function configureUserTimeZone(value?: string): void {
  configuredTimeZone = value?.trim() ? normalizeTimeZoneOffset(value) : undefined;
}

/** 返回当前渲染进程检测到的固定 UTC 偏移。 */
export function detectedUserTimeZone(): string {
  const minutes = -new Date().getTimezoneOffset();
  const sign = minutes < 0 ? "-" : "+";
  const absolute = Math.abs(minutes);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

/** 优先使用显式配置，否则使用系统时区。 */
export function userTimeZone(value = configuredTimeZone): string {
  return value?.trim() ? normalizeTimeZoneOffset(value) : detectedUserTimeZone();
}

/** 以用户时区格式化绝对时间。 */
export function formatUserDateTime(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString(configuredLocale, { timeZone: userTimeZone() });
}

/** 列表里的短时间：今天/昨天只显示钟点，今年省略年份，更早才写全日期。 */
export function formatUserListTime(
  value: string | number | Date,
  language: "zh-CN" | "en-US",
  words: { today: string; yesterday: string },
  now = new Date()
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const timeZone = userTimeZone();
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(d);
  const clock = new Intl.DateTimeFormat(language, { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  if (day(date) === day(now)) return `${words.today} ${clock}`;
  if (day(date) === day(new Date(now.getTime() - 86_400_000))) return `${words.yesterday} ${clock}`;
  const sameYear = day(date).slice(0, 4) === day(now).slice(0, 4);
  return new Intl.DateTimeFormat(language, {
    timeZone,
    year: sameYear ? undefined : "numeric",
    month: language === "zh-CN" ? "long" : "short",
    day: "numeric"
  }).format(date);
}

/** 以用户时区格式化绝对时间，只返回时间部分。 */
export function formatUserTime(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleTimeString(configuredLocale, { timeZone: userTimeZone() });
}

function normalizeTimeZoneOffset(value: string): string {
  if (/^(?:UTC|GMT|Z)$/i.test(value.trim())) return "+00:00";
  const fixed = /^(?:(?:UTC|GMT)\s*)?([+-])(\d{1,2})(?::?(\d{2}))?$/i.exec(value.trim());
  if (fixed) {
    const hours = Number(fixed[2]);
    const minutes = Number(fixed[3] ?? 0);
    if (hours <= 14 && minutes <= 59 && (hours < 14 || minutes === 0)) {
      return `${fixed[1]}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
    }
  }
  const offsetName = new Intl.DateTimeFormat("en-US", {
    timeZone: value,
    timeZoneName: "longOffset"
  }).formatToParts(new Date()).find((part) => part.type === "timeZoneName")?.value;
  if (!offsetName || offsetName === value) throw new Error(`invalid timezone: ${value}`);
  return normalizeTimeZoneOffset(offsetName);
}
