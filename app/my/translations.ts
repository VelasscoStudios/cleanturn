// Fixed UI text for the cleaner view, in English and Ukrainian. Only static
// chrome is translated — dynamic data (names, addresses, notes, directions)
// renders as stored.

export type Lang = "en" | "uk";

// Ukrainian counts: 1/2-4 → "прибирання", 0/5+/11-14 → "прибирань".
function ukCleansWord(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return "прибирань";
  const mod10 = n % 10;
  return mod10 >= 1 && mod10 <= 4 ? "прибирання" : "прибирань";
}

export const STRINGS = {
  en: {
    hi: (name: string) => `Hi ${name}`,
    loading: "Loading your cleans…",
    headline: (today: number, upcoming: number) =>
      `${today} clean${today !== 1 ? "s" : ""} today · ${upcoming} upcoming`,
    loadError: "Couldn't load your jobs. Pull down to try again.",
    actionError: "That didn't go through — try again.",
    emptyLine1: "🎉 No cleans assigned.",
    emptyLine2: "Enjoy the day off!",
    today: "Today",
    upcoming: "Upcoming",
    logout: "Log out",
    saving: "Saving…",
    completed: "✅ Completed — nice work!",
    actionArrived: "🚗 I've arrived",
    actionClean: "✨ Unit is clean",
    scheduledFor: (day: string) => `Scheduled for ${day}`,
    arrive: "Arrive",
    mustBeOutBy: "— must be out by",
    sameDayTurnover: "⚡ Same-day turnover",
    directions: "Directions:",
    access: "Access:",
    dateLocale: "en-US",
  },
  uk: {
    hi: (name: string) => `Привіт, ${name}`,
    loading: "Завантаження ваших прибирань…",
    headline: (today: number, upcoming: number) =>
      `${today} ${ukCleansWord(today)} сьогодні · ${upcoming} попереду`,
    loadError: "Не вдалося завантажити ваші прибирання. Потягніть вниз, щоб спробувати ще раз.",
    actionError: "Не вдалося зберегти — спробуйте ще раз.",
    emptyLine1: "🎉 Прибирань не призначено.",
    emptyLine2: "Гарного вихідного!",
    today: "Сьогодні",
    upcoming: "Найближчі",
    logout: "Вийти",
    saving: "Збереження…",
    completed: "✅ Готово — гарна робота!",
    actionArrived: "🚗 Я на місці",
    actionClean: "✨ Приміщення чисте",
    scheduledFor: (day: string) => `Заплановано на ${day}`,
    arrive: "Прибути о",
    mustBeOutBy: "— вийти до",
    sameDayTurnover: "⚡ Заїзд того ж дня",
    directions: "Як дістатися:",
    access: "Доступ:",
    dateLocale: "uk-UA",
  },
} as const;

export type Strings = (typeof STRINGS)[Lang];
