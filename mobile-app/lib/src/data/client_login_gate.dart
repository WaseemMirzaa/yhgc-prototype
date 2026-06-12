import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:crypto/crypto.dart';
import 'package:yhgc_mobile_app/src/config/app_settings.dart';

/// Matches admin seed / AuthController demo login code when Firestore is not used.
const kFallbackDemoLoginCode = 'YHG-2026-1001';

// --- Client password hashing (salted PBKDF2-HMAC-SHA256) ---------------------
// Passwords are never stored in plaintext. Firestore is world-readable in the
// prototype, so a slow salted hash keeps credentials safe even if the document
// is read. Verification is self-contained to the mobile app.
const int _kPasswordIterations = 64000;
const String _kPasswordAlgo = 'pbkdf2-sha256';

String _bytesToHex(List<int> bytes) =>
    bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();

List<int> _hexToBytes(String hex) {
  final out = <int>[];
  for (var i = 0; i + 1 < hex.length; i += 2) {
    out.add(int.parse(hex.substring(i, i + 2), radix: 16));
  }
  return out;
}

List<int> _pbkdf2Sha256(String password, List<int> salt, int iterations) {
  final hmac = Hmac(sha256, utf8.encode(password));
  // Single output block is enough: dkLen (32) == hLen for SHA-256.
  var u = hmac.convert(<int>[...salt, 0, 0, 0, 1]).bytes;
  final t = Uint8List.fromList(u);
  for (var i = 1; i < iterations; i++) {
    u = hmac.convert(u).bytes;
    for (var j = 0; j < t.length; j++) {
      t[j] ^= u[j];
    }
  }
  return t;
}

List<int> _randomSalt([int len = 16]) {
  final rnd = Random.secure();
  return List<int>.generate(len, (_) => rnd.nextInt(256));
}

/// Firestore fields that persist a salted hash for a password. Pure (safe in set/merge/create).
Map<String, dynamic> hashedPasswordFields(String password) {
  final salt = _randomSalt();
  final hash = _pbkdf2Sha256(password, salt, _kPasswordIterations);
  return {
    'appPasswordHash': _bytesToHex(hash),
    'appPasswordSalt': _bytesToHex(salt),
    'appPasswordIter': _kPasswordIterations,
    'appPasswordAlgo': _kPasswordAlgo,
  };
}

bool _constantTimeEquals(String a, String b) {
  if (a.length != b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) {
    diff |= a.codeUnitAt(i) ^ b.codeUnitAt(i);
  }
  return diff == 0;
}

bool _verifyClientPasswordData(Map<String, dynamic> data, String password) {
  final storedHash = (data['appPasswordHash'] ?? '').toString();
  if (storedHash.isNotEmpty) {
    final salt = _hexToBytes((data['appPasswordSalt'] ?? '').toString());
    final iter = (data['appPasswordIter'] as num?)?.toInt() ?? _kPasswordIterations;
    final computed = _bytesToHex(_pbkdf2Sha256(password, salt, iter));
    return _constantTimeEquals(computed, storedHash);
  }
  // Legacy fallback: accounts created before hashing still log in until their next change.
  final legacy = (data['appPassword'] ?? '').toString();
  return legacy.isNotEmpty && legacy == password;
}

bool _hasPasswordSet(Map<dynamic, dynamic> data) {
  if ((data['appPasswordHash'] ?? '').toString().trim().isNotEmpty) return true;
  return (data['appPassword'] ?? '').toString().trim().isNotEmpty;
}

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
        final hasPassword = _hasPasswordSet(raw);
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
      final hasPassword = _hasPasswordSet(raw);
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
  return _verifyClientPasswordData(data, password);
}

Future<void> setClientPassword({
  required String clientId,
  required String password,
}) async {
  await FirebaseFirestore.instance.collection('clients').doc(clientId).set({
    ...hashedPasswordFields(password),
    'appPassword': FieldValue.delete(), // scrub any legacy plaintext
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

class ClientPasswordResetResult {
  const ClientPasswordResetResult({
    required this.success,
    this.message,
    this.clientId,
  });

  final bool success;
  final String? message;
  final String? clientId;

  factory ClientPasswordResetResult.denied(String message) =>
      ClientPasswordResetResult(success: false, message: message);
}

Future<ClientPasswordResetResult> resetClientPasswordWithVerification({
  required String loginCode,
  required String email,
  required String newPassword,
}) async {
  final code = loginCode.trim();
  final em = email.trim().toLowerCase();
  if (code.isEmpty) {
    return ClientPasswordResetResult.denied('Enter your login code.');
  }
  if (em.isEmpty || !em.contains('@')) {
    return ClientPasswordResetResult.denied('Enter a valid registered email.');
  }
  if (newPassword.length < 8) {
    return ClientPasswordResetResult.denied('Password must be at least 8 characters.');
  }

  if (!appSettings.useLiveFirestore) {
    if (code == kFallbackDemoLoginCode) {
      return const ClientPasswordResetResult(success: true, clientId: 'client-1');
    }
    return ClientPasswordResetResult.denied('No account found for this login code and email.');
  }

  try {
    final clientsSnap = await FirebaseFirestore.instance
        .collection('clients')
        .get(const GetOptions(source: Source.server));

    DocumentSnapshot<Map<String, dynamic>>? matched;
    for (final d in clientsSnap.docs) {
      final raw = d.data();
      if ((raw['loginCode'] ?? '').toString().trim() != code) continue;
      matched = d;
      break;
    }

    if (matched == null) {
      return ClientPasswordResetResult.denied(
        'No account found for this login code and email.',
      );
    }

    final raw = matched.data() ?? <String, dynamic>{};
    final storedEmail = (raw['email'] ?? '').toString().trim().toLowerCase();
    if (storedEmail.isEmpty) {
      return ClientPasswordResetResult.denied(
        'This account has no email on file. Contact your adviser to reset your password.',
      );
    }
    if (storedEmail != em) {
      return ClientPasswordResetResult.denied(
        'Email does not match the account for this login code.',
      );
    }

    final st = (raw['status'] ?? 'active').toString();
    if (st == 'suspended') {
      return ClientPasswordResetResult.denied(
        'This account is suspended. Contact your adviser.',
      );
    }
    if (st == 'revoked') {
      return ClientPasswordResetResult.denied(
        'This account has been revoked. Contact your adviser.',
      );
    }
    if (!_hasPasswordSet(raw)) {
      return ClientPasswordResetResult.denied(
        'No password set yet. Leave the password blank on login to create one.',
      );
    }

    await setClientPassword(clientId: matched.id, password: newPassword);
    return ClientPasswordResetResult(success: true, clientId: matched.id);
  } catch (_) {
    return ClientPasswordResetResult.denied(
      'Could not reset password. Check your connection and try again.',
    );
  }
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
    ...hashedPasswordFields(password),
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
          'appPasswordHash': FieldValue.delete(),
          'appPasswordSalt': FieldValue.delete(),
          'appPasswordIter': FieldValue.delete(),
          'appPasswordAlgo': FieldValue.delete(),
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
