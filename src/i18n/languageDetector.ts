import { getLocales } from 'expo-localization';
import { LanguageDetectorAsyncModule } from 'i18next';
import { mmkvStorage } from '../services/mmkvStorage';

const languageDetector: LanguageDetectorAsyncModule = {
  type: "languageDetector",
  async: true,
  detect: (callback: (lng: string | undefined) => void): void => {
    const findLanguage = async () => {
      try {
        const savedLanguage = await mmkvStorage.getItem("user_language");
        if (savedLanguage) {
          callback(savedLanguage);
          return;
        }

        const locales = getLocales();
        if (!locales || locales.length === 0) {
          callback("en");
          return;
        }

        const bestTag = locales[0].languageTag;
        callback(bestTag);
      } catch (error) {
        console.error("[LangDetector(TEST)] Failed to detect language:", error);
        callback("en");
      }
    };
    findLanguage();
  },
  init: () => {},
  cacheUserLanguage: (language: string) => {
    mmkvStorage.setItem("user_language", language);
  },
};

export default languageDetector;