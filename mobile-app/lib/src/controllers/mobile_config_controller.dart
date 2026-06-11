import 'dart:async';

import 'package:get/get.dart';
import 'package:yhgc_mobile_app/src/data/mobile_app_config.dart';

class MobileConfigController extends GetxController {
  final config = MobileAppConfig.defaults.obs;
  final ready = false.obs;

  bool get allowMobileSignup => config.value.allowMobileSignup;

  String get privacyUrl => config.value.privacyUrl;

  String get termsUrl => config.value.termsUrl;

  @override
  void onInit() {
    super.onInit();
    unawaited(reloadConfig());
  }

  Future<void> reloadConfig() async {
    config.value = await loadMobileAppConfig();
    ready.value = true;
  }
}
