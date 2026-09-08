// 30-minute intervals, 6:00 AM through 10:00 PM.
export const TIME_OPTIONS: string[] = (() => {
  const times: string[] = [];
  for (let minutes = 6 * 60; minutes <= 22 * 60; minutes += 30) {
    const hour24 = Math.floor(minutes / 60);
    const min = minutes % 60;
    const period = hour24 < 12 ? "AM" : "PM";
    const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
    times.push(`${hour12}:${min.toString().padStart(2, "0")} ${period}`);
  }
  return times;
})();
