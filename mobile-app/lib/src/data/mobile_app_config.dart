import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:yhgc_mobile_app/src/config/app_settings.dart';

class MobileAppConfig {
  const MobileAppConfig({
    required this.allowMobileSignup,
    required this.privacyPolicyPath,
    required this.privacyPolicyUrl,
    required this.termsOfServicePath,
    required this.termsOfServiceUrl,
  });

  final bool allowMobileSignup;
  final String privacyPolicyPath;
  final String privacyPolicyUrl;
  final String termsOfServicePath;
  final String termsOfServiceUrl;

  static const defaults = MobileAppConfig(
    allowMobileSignup: false,
    privacyPolicyPath: '/privacy',
    privacyPolicyUrl: '',
    termsOfServicePath: '/terms',
    termsOfServiceUrl: '',
  );

  String pageUrl(String path, {String? externalOverride}) {
    final external = (externalOverride ?? '').trim();
    if (external.isNotEmpty) return external;
    final base = appSettings.accountantPortalBaseUrl.replaceAll(RegExp(r'/+$'), '');
    final normalized = path.startsWith('/') ? path : '/$path';
    return '$base$normalized';
  }

  String get privacyUrl => pageUrl(privacyPolicyPath, externalOverride: privacyPolicyUrl);

  String get termsUrl => pageUrl(termsOfServicePath, externalOverride: termsOfServiceUrl);
}

Future<MobileAppConfig> loadMobileAppConfig() async {
  if (!appSettings.useLiveFirestore) return MobileAppConfig.defaults;
  try {
    final snap = await FirebaseFirestore.instance
        .doc('appConfig/mobile')
        .get(const GetOptions(source: Source.server));
    final raw = snap.data();
    if (raw == null) return MobileAppConfig.defaults;
    return MobileAppConfig(
      allowMobileSignup: raw['allowMobileSignup'] == true,
      privacyPolicyPath: (raw['privacyPolicyPath'] ?? MobileAppConfig.defaults.privacyPolicyPath).toString(),
      privacyPolicyUrl: (raw['privacyPolicyUrl'] ?? '').toString(),
      termsOfServicePath: (raw['termsOfServicePath'] ?? MobileAppConfig.defaults.termsOfServicePath).toString(),
      termsOfServiceUrl: (raw['termsOfServiceUrl'] ?? '').toString(),
    );
  } catch (_) {
    return MobileAppConfig.defaults;
  }
}
