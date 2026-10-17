import spanish from "./src/_gt/es.json";
import japanese from "./src/_gt/ja.json";
import korean from "./src/_gt/ko.json";

export async function loadTranslations(locale: string) {
  if (locale === "es") return spanish;
  if (locale === "ja") return japanese;
  if (locale === "ko") return korean;
  return {};
}
