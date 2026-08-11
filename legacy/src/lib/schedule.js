// Calling-window helpers. Windows are expressed in each campaign's IANA timezone
// as [start, end) local hours. start === end means "always allowed" (24h).

function getLocalHour(date, timeZone) {
  try {
    const s = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      hour12: false
    }).format(date);
    return parseInt(s, 10) % 24;
  } catch {
    return date.getHours();
  }
}

function isWithinWindow(campaign, now = new Date()) {
  const start = Number(campaign.call_window_start);
  const end = Number(campaign.call_window_end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return true;
  const hour = getLocalHour(now, campaign.timezone || "UTC");
  if (start < end) return hour >= start && hour < end;
  // window wraps past midnight, e.g. 20 -> 6
  return hour >= start || hour < end;
}

module.exports = { getLocalHour, isWithinWindow };
