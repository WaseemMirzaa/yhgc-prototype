import 'package:flutter/widgets.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// App language toggle (French default, English available). Persists the choice
/// and drives GetX translations + locale-aware formatting.
class LocaleController extends GetxController {
  static const _kLangKey = 'yhgc_lang';

  /// Supported UI languages. French is the prototype default.
  static const fr = Locale('fr');
  static const en = Locale('en');
  static const fallback = fr;

  final Rx<Locale> locale = fr.obs;

  bool get isFrench => locale.value.languageCode == 'fr';

  /// Read the saved language before runApp so the first frame is already localized.
  static Future<Locale> loadInitialLocale() async {
    final prefs = await SharedPreferences.getInstance();
    final code = prefs.getString(_kLangKey);
    return code == 'en' ? en : fr;
  }

  Future<void> setLocale(Locale next) async {
    locale.value = next;
    Get.updateLocale(next);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kLangKey, next.languageCode);
  }

  Future<void> toggle() => setLocale(isFrench ? en : fr);
}
