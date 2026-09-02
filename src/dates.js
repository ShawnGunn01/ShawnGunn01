// Date helpers shared by the cohort/timing engine. All dates are 'YYYY-MM-DD' strings.

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(fromStr, toStr) {
  const from = new Date(fromStr);
  const to = new Date(toStr);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  return Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

// How many days ago a date was. Missing/invalid date = Infinity (i.e. "forever ago", so it reads as dormant/lapsed rather than silently excluded).
function daysSince(dateStr) {
  if (!dateStr) return Infinity;
  const d = daysBetween(dateStr, todayStr());
  return d === null ? Infinity : d;
}

// How many days from now until a future date. Missing/invalid date = -Infinity (i.e. "already passed"), so anniversary-timed logic treats it as due rather than never-due.
function daysUntil(dateStr) {
  if (!dateStr) return -Infinity;
  const d = daysBetween(todayStr(), dateStr);
  return d === null ? -Infinity : d;
}

function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// Approximate business days elapsed since a date (skips Sat/Sun; does not
// account for holidays — good enough for the 3/7-10 business-day triggers).
function businessDaysSince(dateStr) {
  if (!dateStr) return Infinity;
  const start = new Date(dateStr);
  const end = new Date(todayStr());
  if (Number.isNaN(start.getTime())) return Infinity;
  let count = 0;
  const cursor = new Date(start);
  while (cursor < end) {
    cursor.setDate(cursor.getDate() + 1);
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
}

function inRange(value, min, max) {
  return value >= min && value <= max;
}

module.exports = { todayStr, daysBetween, daysSince, daysUntil, addDays, businessDaysSince, inRange };
