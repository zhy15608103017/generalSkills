const LOCAL_TIME_ZONE_VALUES = new Set(["", "system", "local", "default"]);
const FIXED_OFFSET_PATTERN = /^(?:UTC|GMT)?([+-])(\d{1,2})(?::?(\d{2}))?$/i;

export function formatReviewTime(date = new Date(), options = {}) {
  const timeZone = resolveReviewTimeZone(options);
  if (!timeZone) return formatParts(localDateParts(date));

  const fixedOffset = parseFixedOffset(timeZone);
  if (fixedOffset !== null) {
    return formatParts(offsetDateParts(date, fixedOffset));
  }

  return formatNamedTimeZone(date, timeZone);
}

export function formatReviewRunId(date = new Date(), options = {}) {
  return formatReviewTime(date, options).replace(" ", "_").replace(/:/g, "-");
}

export function resolveReviewTimeZone(options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, "timeZone")) {
    return normalizeTimeZone(options.timeZone);
  }
  return normalizeTimeZone(process.env.AI_REVIEW_TIME_ZONE);
}

function normalizeTimeZone(value) {
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  if (LOCAL_TIME_ZONE_VALUES.has(trimmed.toLowerCase())) return undefined;
  return trimmed;
}

function formatNamedTimeZone(date, timeZone) {
  try {
    const parts = namedTimeZoneParts(date, timeZone);
    return formatParts(parts);
  } catch (error) {
    throw new Error(
      `无效的审核时间时区配置: ${timeZone}。请使用 IANA 时区名（如 Asia/Shanghai）或固定偏移（如 +08:00）。`,
      { cause: error },
    );
  }
}

function namedTimeZoneParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const values = Object.fromEntries(
    formatter.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
    millisecond: date.getMilliseconds(),
  };
}

function localDateParts(date) {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
    second: date.getSeconds(),
    millisecond: date.getMilliseconds(),
  };
}

function offsetDateParts(date, offsetMinutes) {
  const shifted = new Date(date.getTime() + offsetMinutes * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    millisecond: shifted.getUTCMilliseconds(),
  };
}

function parseFixedOffset(timeZone) {
  if (/^(?:UTC|GMT|Z)$/i.test(timeZone)) return 0;
  const match = FIXED_OFFSET_PATTERN.exec(timeZone);
  if (!match) return null;

  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] || 0);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours > 23 || minutes > 59) {
    throw new Error(`无效的固定时区偏移: ${timeZone}`);
  }
  return sign * (hours * 60 + minutes);
}

function formatParts(parts) {
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`
    + ` ${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;
}

function pad(value, size = 2) {
  return String(value).padStart(size, "0");
}
