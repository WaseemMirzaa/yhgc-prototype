// Credentials from ios/Runner/GoogleService-Info.plist and android/app/google-services.json
import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;
import 'package:flutter/foundation.dart' show defaultTargetPlatform, kIsWeb, TargetPlatform;

class DefaultFirebaseOptions {
  static FirebaseOptions get currentPlatform {
    if (kIsWeb) {
      throw UnsupportedError('Web Firebase is not configured for this app.');
    }
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return android;
      case TargetPlatform.iOS:
      case TargetPlatform.macOS:
        return ios;
      default:
        throw UnsupportedError('Firebase is not supported on $defaultTargetPlatform.');
    }
  }

  static const FirebaseOptions android = FirebaseOptions(
    apiKey: 'AIzaSyD6syLyhwZto4ilnevG1uOzW439wopH0CY',
    appId: '1:520482432285:android:1bc9c3b1b7a735b85fadf4',
    messagingSenderId: '520482432285',
    projectId: 'yhgc-77841',
    storageBucket: 'yhgc-77841.firebasestorage.app',
  );

  static const FirebaseOptions ios = FirebaseOptions(
    apiKey: 'AIzaSyD64jNEut8GM50GuPny5xP1cO3EA4qYumU',
    appId: '1:520482432285:ios:2d2bf7f8e91021055fadf4',
    messagingSenderId: '520482432285',
    projectId: 'yhgc-77841',
    storageBucket: 'yhgc-77841.firebasestorage.app',
    iosBundleId: 'com.app.yhgc',
  );
}
 