import 'package:flutter/widgets.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// English-only UI locale for the mobile app.
class LocaleController extends GetxController {
  static const _kLangKey = 'yhgc_lang';

  static const en = Locale('en');
  static const fallback = en;

  final Rx<Locale> locale = en.obs;

  /// Always English; clears any legacy French preference.
  static Future<Locale> loadInitialLocale() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kLangKey, 'en');
    return en;
  }

  Future<void> setLocale(Locale next) async {
    locale.value = en;
    Get.updateLocale(en);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kLangKey, 'en');
  }
}
