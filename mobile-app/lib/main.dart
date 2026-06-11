import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:yhgc_mobile_app/firebase_options.dart';
import 'package:yhgc_mobile_app/src/app.dart';
import 'package:yhgc_mobile_app/src/config/app_settings.dart';
import 'package:yhgc_mobile_app/src/services/fcm_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  if (appSettings.useLiveFirestore) {
    await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
    FirebaseMessaging.onBackgroundMessage(yhgcFirebaseMessagingBackgroundHandler);
    await FcmService.instance.configureMessaging();
  }
  runApp(const YhgcApp());
}
