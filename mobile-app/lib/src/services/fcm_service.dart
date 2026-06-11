import 'dart:async';
import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:crypto/crypto.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart' show defaultTargetPlatform, TargetPlatform;
import 'package:flutter/widgets.dart';
import 'package:get/get.dart';
import 'package:yhgc_mobile_app/firebase_options.dart';
import 'package:yhgc_mobile_app/src/config/app_settings.dart';
import 'package:yhgc_mobile_app/src/controllers/app_controller.dart';

/// Bottom-nav index for the Alerts tab in [ShellPage].
const int kAlertsTabIndex = 3;

/// Must match `tokenDocId` in `admin-web/functions` (SHA-256 hex, first 32 chars).
String fcmTokenDocId(String token) {
  final digest = sha256.convert(utf8.encode(token));
  return digest.toString().substring(0, 32);
}

String _platformLabel() {
  switch (defaultTargetPlatform) {
    case TargetPlatform.iOS:
      return 'ios';
    case TargetPlatform.android:
      return 'android';
    default:
      return 'flutter';
  }
}

@pragma('vm:entry-point')
Future<void> yhgcFirebaseMessagingBackgroundHandler(RemoteMessage message) async {
  WidgetsFlutterBinding.ensureInitialized();
  if (!appSettings.useLiveFirestore) return;
  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
}

class FcmService {
  FcmService._();
  static final FcmService instance = FcmService._();

  String? _activeClientId;
  StreamSubscription<String>? _tokenRefreshSub;
  StreamSubscription<RemoteMessage>? _foregroundSub;
  StreamSubscription<RemoteMessage>? _openedAppSub;
  bool _handlersBound = false;
  bool _pendingOpenAlerts = false;

  /// Call once after Firebase.initializeApp (before or after runApp).
  Future<void> configureMessaging() async {
    if (!appSettings.useLiveFirestore || _handlersBound) return;
    _handlersBound = true;

    final messaging = FirebaseMessaging.instance;
    await messaging.setForegroundNotificationPresentationOptions(
      alert: true,
      badge: true,
      sound: true,
    );

    final initial = await messaging.getInitialMessage();
    if (initial != null) {
      _pendingOpenAlerts = true;
    }

    await _foregroundSub?.cancel();
    _foregroundSub = FirebaseMessaging.onMessage.listen(_handleForegroundMessage);

    await _openedAppSub?.cancel();
    _openedAppSub = FirebaseMessaging.onMessageOpenedApp.listen((_) {
      _openAlertsTab();
    });
  }

  Future<void> startForClient(String? clientId) async {
    if (!appSettings.useLiveFirestore || clientId == null || clientId.isEmpty) return;
    _activeClientId = clientId;

    final messaging = FirebaseMessaging.instance;
    await messaging.requestPermission(alert: true, badge: true, sound: true);
    final token = await messaging.getToken();
    if (token != null && token.isNotEmpty) {
      await _saveToken(clientId, token);
    }
    await _tokenRefreshSub?.cancel();
    _tokenRefreshSub = messaging.onTokenRefresh.listen((next) async {
      final cid = _activeClientId;
      if (cid == null || cid.isEmpty) return;
      await _saveToken(cid, next);
    });
  }

  Future<void> stopForClient(String? clientId) async {
    if (!appSettings.useLiveFirestore || clientId == null || clientId.isEmpty) {
      _activeClientId = null;
      await _tokenRefreshSub?.cancel();
      _tokenRefreshSub = null;
      return;
    }
    final token = await FirebaseMessaging.instance.getToken();
    if (token == null || token.isEmpty) {
      _activeClientId = null;
      await _tokenRefreshSub?.cancel();
      _tokenRefreshSub = null;
      return;
    }
    final docId = fcmTokenDocId(token);
    await FirebaseFirestore.instance.doc('users/$clientId/fcmTokens/$docId').delete();
    _activeClientId = null;
    await _tokenRefreshSub?.cancel();
    _tokenRefreshSub = null;
  }

  /// Opens Alerts tab when app was launched from a notification tap.
  void applyPendingNavigation() {
    if (!_pendingOpenAlerts) return;
    _pendingOpenAlerts = false;
    _openAlertsTab();
  }

  void _handleForegroundMessage(RemoteMessage message) {
    final title = message.notification?.title ?? 'Portfolio update';
    final body = message.notification?.body ?? 'Your adviser has sent an update.';
    Get.snackbar(title, body, snackPosition: SnackPosition.TOP, duration: const Duration(seconds: 4));
    _refreshPortfolio();
  }

  void _openAlertsTab() {
    if (Get.isRegistered<AppController>()) {
      final app = Get.find<AppController>();
      app.tab.value = kAlertsTabIndex;
      app.unread.value = 0;
      _refreshPortfolio();
      return;
    }
    _pendingOpenAlerts = true;
  }

  void _refreshPortfolio() {
    if (!Get.isRegistered<AppController>()) return;
    final app = Get.find<AppController>();
    if (app.repository.portfolioSnapshotStream != null) {
      unawaited(app.refreshFirebasePortfolio());
    }
  }

  Future<void> _saveToken(String clientId, String token) async {
    final docId = fcmTokenDocId(token);
    await FirebaseFirestore.instance.doc('users/$clientId/fcmTokens/$docId').set({
      'token': token,
      'platform': _platformLabel(),
      'updatedAt': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
  }
}
