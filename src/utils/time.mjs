import { endOfDay, startOfDay } from './parse.mjs';

export function toIsoDatetime(date) {
  return new Date(date).toISOString();
}

export function formatDateId(date) {
  const d = new Date(date);
  return d.toLocaleDateString('id-ID', { year: 'numeric', month: 'short', day: 'numeric' });
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function startOfWeekMonday(date) {
  const d = startOfDay(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(d, diff);
}

function endOfWeekSunday(date) {
  const start = startOfWeekMonday(date);
  return endOfDay(addDays(start, 6));
}

function startOfMonth(date) {
  const d = new Date(date);
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(date) {
  const d = new Date(date);
  return endOfDay(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

export function parseTimePeriod(input, now = new Date()) {
  if (!input) {
    return lastNDays(7, now, '7 hari terakhir');
  }

  if (typeof input === 'object' && input.start && input.end) {
    return {
      start: toIsoDatetime(startOfDay(input.start)),
      end: toIsoDatetime(endOfDay(input.end)),
      label: 'Periode kustom',
      granularity: input.granularity ?? 'day',
    };
  }

  const keyword = String(input).toLowerCase().trim();

  if (keyword.includes('hari ini') || keyword === 'today') {
    return {
      start: toIsoDatetime(startOfDay(now)),
      end: toIsoDatetime(endOfDay(now)),
      label: 'Hari ini',
      granularity: 'hour',
    };
  }

  if (keyword.includes('kemarin') || keyword === 'yesterday') {
    const d = addDays(now, -1);
    return {
      start: toIsoDatetime(startOfDay(d)),
      end: toIsoDatetime(endOfDay(d)),
      label: 'Kemarin',
      granularity: 'hour',
    };
  }

  if (keyword.includes('minggu ini') || keyword === 'this_week') {
    return {
      start: toIsoDatetime(startOfWeekMonday(now)),
      end: toIsoDatetime(endOfDay(now)),
      label: 'Minggu ini',
      granularity: 'day',
    };
  }

  if (keyword.includes('minggu lalu') || keyword === 'last_week') {
    const start = addDays(startOfWeekMonday(now), -7);
    const end = endOfDay(addDays(start, 6));
    return {
      start: toIsoDatetime(start),
      end: toIsoDatetime(end),
      label: 'Minggu lalu',
      granularity: 'day',
    };
  }

  if (keyword.includes('bulan ini') || keyword === 'this_month') {
    return {
      start: toIsoDatetime(startOfMonth(now)),
      end: toIsoDatetime(endOfDay(now)),
      label: 'Bulan ini',
      granularity: 'day',
    };
  }

  if (keyword.includes('bulan lalu') || keyword === 'last_month') {
    const ref = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return {
      start: toIsoDatetime(startOfMonth(ref)),
      end: toIsoDatetime(endOfMonth(ref)),
      label: 'Bulan lalu',
      granularity: 'day',
    };
  }

  if (keyword.includes('30') || keyword.includes('sebulan') || keyword === 'last_30_days') {
    return lastNDays(30, now, '30 hari terakhir');
  }

  if (keyword.includes('90') || keyword.includes('3 bulan') || keyword === 'last_90_days') {
    return lastNDays(90, now, '90 hari terakhir');
  }

  return lastNDays(7, now, '7 hari terakhir');
}

export function lastNDays(days, now = new Date(), label = '') {
  const end = endOfDay(now);
  const start = startOfDay(addDays(now, -(days - 1)));
  return {
    start: toIsoDatetime(start),
    end: toIsoDatetime(end),
    label: label || `${days} hari terakhir`,
    granularity: days > 45 ? 'week' : 'day',
  };
}

export function previousPeriod(period) {
  const start = new Date(period.start);
  const end = new Date(period.end);
  const span = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - span);

  return {
    start: toIsoDatetime(prevStart),
    end: toIsoDatetime(prevEnd),
    label: `Periode sebelum ${period.label}`,
    granularity: period.granularity,
  };
}
