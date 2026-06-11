class AppSettings {
  final bool mocked;
  final FirebaseConfig firebase;
  final String accountantPortalBaseUrl;

  /// When true, cold start stays on [SplashPage] (no handoff to login/shell). Turn off for normal app flow.
  final bool splashPreviewOnly;

  const AppSettings({
    required this.mocked,
    required this.firebase,
    required this.accountantPortalBaseUrl,
    this.splashPreviewOnly = false,
  });

  /// Same idea as admin `useMockedBackend: false`: read/write `appSnapshots/adminPrototype` in Firestore.
  bool get useLiveFirestore => !mocked && firebase.isConfigured;
}

class FirebaseConfig {
  final String apiKey;
  final String appId;
  final String messagingSenderId;
  final String projectId;
  final String storageBucket;

  const FirebaseConfig({
    required this.apiKey,
    required this.appId,
    required this.messagingSenderId,
    required this.projectId,
    required this.storageBucket,
  });

  bool get isConfigured =>
      apiKey.isNotEmpty &&
      appId.isNotEmpty &&
      messagingSenderId.isNotEmpty &&
      projectId.isNotEmpty &&
      storageBucket.isNotEmpty;
}

const appSettings = AppSettings(
  mocked: false,
  splashPreviewOnly: false,
  accountantPortalBaseUrl: 'https://yhgc-77841.web.app',
  // Platform app IDs / API keys live in lib/firebase_options.dart (from GoogleService-Info.plist + google-services.json).
  firebase: FirebaseConfig(
    apiKey: 'AIzaSyD64jNEut8GM50GuPny5xP1cO3EA4qYumU',
    appId: '1:520482432285:ios:2d2bf7f8e91021055fadf4',
    messagingSenderId: '520482432285',
    projectId: 'yhgc-77841',
    storageBucket: 'yhgc-77841.firebasestorage.app',
  ),
);
