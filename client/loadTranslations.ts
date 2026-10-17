import spanish from "./src/_gt/es.json";
import japanese from "./src/_gt/ja.json";
import korean from "./src/_gt/ko.json";
import swedish from "./src/_gt/sv.json";

export async function loadTranslations(locale: string) {
  if (locale === "es") return spanish;
  if (locale === "ja") return japanese;
  if (locale === "ko") return korean;
  if (locale === "sv") return swedish;
  return {};
}
