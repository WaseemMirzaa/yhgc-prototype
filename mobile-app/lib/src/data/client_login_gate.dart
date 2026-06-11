import 'dart:math';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:yhgc_mobile_app/src/config/app_settings.dart';

/// Matches admin seed / AuthController demo login code when Firestore is not used.
const kFallbackDemoLoginCode = 'YHG-2026-1001';

class ClientLoginAccess {
  const ClientLoginAccess({
    required this.allowed,
    this.message,
    this.clientId,
    this.hasPassword,
  });

  final bool allowed;
  final String? message;
  /// Firestore `clients[].id` when [allowed]; used to scope portfolio data on the device.
  final String? clientId;
  /// Whether a password is already configured for this client.
  final bool? hasPassword;

  static ClientLoginAccess ok({String? clientId, bool? hasPassword}) =>
      ClientLoginAccess(
        allowed: true,
        clientId: clientId,
        hasPassword: hasPassword,
      );

  factory ClientLoginAccess.denied(String message) =>
      ClientLoginAccess(allowed: false, message: message);
}

Future<ClientLoginAccess> verifyClientLoginCode(String loginCode) async {
  final code = loginCode.trim();
  if (code.isEmpty) {
    return ClientLoginAccess.denied('Enter your login code.');
  }
  if (appSettings.useLiveFirestore) {
    return _checkClientFromFirestore(code);
  }
  if (code == kFallbackDemoLoginCode) {
    return ClientLoginAccess.ok(clientId: 'client-1', hasPassword: false);
  }
  return ClientLoginAccess.denied('Unknown login code.');
}

Future<ClientLoginAccess> _checkClientFromFirestore(String code) async {
  try {
    final clientsSnap = await FirebaseFirestore.instance
        .collection('clients')
        .get(const GetOptions(source: Source.server));
    if (clientsSnap.docs.isNotEmpty) {
      for (final d in clientsSnap.docs) {
        final raw = d.data();
        final c = (raw['loginCode'] ?? '').toString().trim();
        if (c != code) continue;
        final st = (raw['status'] ?? 'active').toString();
        if (st == 'suspended') {
          return ClientLoginAccess.denied(
            'This account is suspended. Contact your adviser.',
          );
        }
        if (st == 'revoked') {
          return ClientLoginAccess.denied(
            'This account has been revoked. Contact your adviser.',
          );
        }
        final hasPassword = (raw['appPassword'] ?? '').toString().trim().isNotEmpty;
        return ClientLoginAccess.ok(clientId: d.id, hasPassword: hasPassword);
      }
      return ClientLoginAccess.denied('Unknown login code.');
    }

    final doc = await FirebaseFirestore.instance
        .collection('appSnapshots')
        .doc('adminPrototype')
        .get(const GetOptions(source: Source.server));
    final data = doc.data();
    if (data == null) {
      return ClientLoginAccess.denied('Portfolio not provisioned.');
    }
    final rawClients = data['clients'];
    if (rawClients is! List) {
      return ClientLoginAccess.denied('Portfolio not provisioned.');
    }
    for (final raw in rawClients) {
      if (raw is! Map) continue;
      final c = (raw['loginCode'] ?? '').toString().trim();
      if (c != code) continue;
      final st = (raw['status'] ?? 'active').toString();
      if (st == 'suspended') {
        return ClientLoginAccess.denied(
          'This account is suspended. Contact your adviser.',
        );
      }
      if (st == 'revoked') {
        return ClientLoginAccess.denied(
          'This account has been revoked. Contact your adviser.',
        );
      }
      final id = (raw['id'] ?? '').toString().trim();
      if (id.isEmpty) {
        return ClientLoginAccess.denied('Client record is incomplete. Contact your adviser.');
      }
      final hasPassword = (raw['appPassword'] ?? '').toString().trim().isNotEmpty;
      return ClientLoginAccess.ok(clientId: id, hasPassword: hasPassword);
    }
    return ClientLoginAccess.denied('Unknown login code.');
  } catch (_) {
    return ClientLoginAccess.denied(
      'Unable to verify login. Check your connection.',
    );
  }
}

Future<bool> verifyClientPassword({
  required String clientId,
  required String password,
}) async {
  final snap = await FirebaseFirestore.instance
      .collection('clients')
      .doc(clientId)
      .get(const GetOptions(source: Source.server));
  if (!snap.exists) return false;
  final data = snap.data() ?? <String, dynamic>{};
  final stored = (data['appPassword'] ?? '').toString();
  return stored.isNotEmpty && stored == password;
}

Future<void> setClientPassword({
  required String clientId,
  required String password,
}) async {
  await FirebaseFirestore.instance.collection('clients').doc(clientId).set({
    'appPassword': password,
    'passwordUpdatedAt': FieldValue.serverTimestamp(),
  }, SetOptions(merge: true));
}

class ClientSignupResult {
  const ClientSignupResult({
    required this.success,
    this.message,
    this.clientId,
    this.loginCode,
  });

  final bool success;
  final String? message;
  final String? clientId;
  final String? loginCode;

  factory ClientSignupResult.denied(String message) =>
      ClientSignupResult(success: false, message: message);
}

String _generateLoginCode() {
  final year = DateTime.now().year;
  final suffix = 1000 + Random().nextInt(9000);
  return 'YHG-$year-$suffix';
}

Future<bool> _emailExistsInClients(String email) async {
  final normalized = email.trim().toLowerCase();
  final snap = await FirebaseFirestore.instance.collection('clients').get();
  for (final d in snap.docs) {
    final em = (d.data()['email'] ?? '').toString().trim().toLowerCase();
    if (em == normalized) return true;
  }
  return false;
}

Future<bool> _loginCodeExists(String code) async {
  final snap = await FirebaseFirestore.instance.collection('clients').get();
  for (final d in snap.docs) {
    final c = (d.data()['loginCode'] ?? '').toString().trim();
    if (c == code) return true;
  }
  return false;
}

Future<String> _uniqueLoginCode() async {
  for (var i = 0; i < 12; i++) {
    final code = _generateLoginCode();
    if (!await _loginCodeExists(code)) return code;
  }
  return 'YHG-${DateTime.now().year}-${DateTime.now().millisecondsSinceEpoch % 10000}';
}

Future<ClientSignupResult> createClientFromMobileSignup({
  required String fullName,
  required String email,
  required String password,
}) async {
  final name = fullName.trim();
  final em = email.trim();
  if (name.isEmpty) return ClientSignupResult.denied('Enter your full name.');
  if (em.isEmpty || !em.contains('@')) {
    return ClientSignupResult.denied('Enter a valid email address.');
  }
  if (password.length < 8) {
    return ClientSignupResult.denied('Password must be at least 8 characters.');
  }

  if (!appSettings.useLiveFirestore) {
    return const ClientSignupResult(
      success: true,
      clientId: 'client-signup-demo',
      loginCode: 'YHG-2026-SIGNUP',
    );
  }

  final configSnap = await FirebaseFirestore.instance.doc('appConfig/mobile').get();
  final allowSignup = configSnap.data()?['allowMobileSignup'] == true;
  if (!allowSignup) {
    return ClientSignupResult.denied(
      'Account creation from the app is disabled. Contact your adviser for a login code.',
    );
  }

  if (await _emailExistsInClients(em)) {
    return ClientSignupResult.denied('An account with this email already exists. Try logging in.');
  }

  final loginCode = await _uniqueLoginCode();
  final ref = FirebaseFirestore.instance.collection('clients').doc();
  await ref.set({
    'fullName': name,
    'email': em,
    'loginCode': loginCode,
    'status': 'active',
    'createdAt': FieldValue.serverTimestamp(),
    'appPassword': password,
    'passwordUpdatedAt': FieldValue.serverTimestamp(),
    'termsAcceptedAt': FieldValue.serverTimestamp(),
    'privacyAcceptedAt': FieldValue.serverTimestamp(),
    'signupSource': 'mobile_app',
  });

  return ClientSignupResult(success: true, clientId: ref.id, loginCode: loginCode);
}

Future<String?> deleteClientAccountRecord(String clientId) async {
  final cid = clientId.trim();
  if (cid.isEmpty) return 'No client account found.';

  if (!appSettings.useLiveFirestore) return null;

  try {
    final clientRef = FirebaseFirestore.instance.collection('clients').doc(cid);
    final clientSnap = await clientRef.get();
    if (clientSnap.exists) {
      final data = clientSnap.data() ?? <String, dynamic>{};
      final signupSource = (data['signupSource'] ?? '').toString();
      if (signupSource == 'mobile_app') {
        await clientRef.delete();
      } else {
        await clientRef.set({
          'status': 'revoked',
          'appPassword': FieldValue.delete(),
          'accountDeletedAt': FieldValue.serverTimestamp(),
          'accountDeletedFrom': 'mobile_app',
        }, SetOptions(merge: true));
      }
    }

    final tokenSnap = await FirebaseFirestore.instance
        .collection('users')
        .doc(cid)
        .collection('fcmTokens')
        .get();
    for (final d in tokenSnap.docs) {
      await d.reference.delete();
    }
    return null;
  } catch (_) {
    return 'Could not delete your account. Check your connection and try again.';
  }
}
