import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:yhgc_mobile_app/src/config/app_settings.dart';
import 'package:yhgc_mobile_app/src/controllers/app_controller.dart';
import 'package:yhgc_mobile_app/src/controllers/mobile_config_controller.dart';
import 'package:yhgc_mobile_app/src/data/client_login_gate.dart';
import 'package:yhgc_mobile_app/src/data/repository.dart';
import 'package:yhgc_mobile_app/src/services/fcm_service.dart';

class AuthController extends GetxController {
  static const code = 'YHG-2026-1001';
  static const password = 'Client@123';

  final loggedIn = false.obs;
  final firstLogin = true.obs;
  final sessionReady = false.obs;
  final loginCode = ''.obs;
  /// Incremented when Firebase portfolio client scope changes so [AppController] can re-pull.
  final portfolioScopeEpoch = 0.obs;

  String _pendingFirstLoginCode = '';

  static const _kLoggedIn = 'yhgc_logged_in';
  static const _kFirstLogin = 'yhgc_first_login';
  static const _kClientPassword = 'yhgc_client_password';
  static const _kClientId = 'yhgc_firebase_client_id';
  static const _kLoginCode = 'yhgc_login_code';

  @override
  void onInit() {
    super.onInit();
    _loadSession();
  }

  void _pushRepoScope(String? clientId) {
    Get.find<AppRepository>().setPortfolioClientScope(clientId);
  }

  void _notifyPortfolioScopeChanged() {
    portfolioScopeEpoch.value++;
  }

  Future<void> _loadSession() async {
    final prefs = await SharedPreferences.getInstance();
    loggedIn.value = prefs.getBool(_kLoggedIn) ?? false;
    var cid = prefs.getString(_kClientId);
    final storedLoginCode = prefs.getString(_kLoginCode) ?? '';
    final hasLocalSetup =
        storedLoginCode.isNotEmpty || (cid != null && cid.isNotEmpty);
    final storedFirstLogin = prefs.getBool(_kFirstLogin);
    // Prefer server-backed returning users: a saved login code means first-login is done.
    firstLogin.value = hasLocalSetup ? false : (storedFirstLogin ?? true);

    if (appSettings.useLiveFirestore && loggedIn.value && (cid == null || cid.isEmpty)) {
      loggedIn.value = false;
      await prefs.setBool(_kLoggedIn, false);
      await prefs.remove(_kClientId);
      // Keep login code so returning users are not forced back through first-login UX.
      cid = null;
    }

    loginCode.value = storedLoginCode;

    _pushRepoScope(loggedIn.value ? cid : null);
    await FcmService.instance.startForClient(loggedIn.value ? cid : null);
    sessionReady.value = true;
  }

  /// Returns null on success, or an error message.
  Future<String?> tryLogin(String c, String p) async {
    final code = c.trim();
    final pwd = p.trim();
    if (code.isEmpty) {
      return 'Enter your login code.';
    }
    if (pwd.isEmpty) {
      return 'Enter your password, or leave it empty to set up access with your invite code.';
    }
    final gate = await Get.find<AppRepository>().checkClientLoginAccess(code);
    if (!gate.allowed) return gate.message ?? 'Access denied.';
    if (gate.clientId == null || gate.clientId!.isEmpty) {
      return 'Client record is incomplete. Contact your adviser.';
    }
    if (appSettings.useLiveFirestore) {
      if (gate.hasPassword != true) {
        return 'Password not set yet. Leave password blank on login to create one.';
      }
    } else if (firstLogin.value) {
      return 'Use first login with your invite code, then set a password.';
    }
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString(_kClientPassword);
    final ok = appSettings.useLiveFirestore
        ? await verifyClientPassword(clientId: gate.clientId!, password: pwd)
        : (pwd == password || (saved != null && pwd == saved));
    if (!ok) return 'Invalid password.';
    firstLogin.value = false;
    loggedIn.value = true;
    await prefs.setString(_kClientId, gate.clientId!);
    await prefs.setString(_kLoginCode, code);
    loginCode.value = code;
    _pushRepoScope(gate.clientId);
    await FcmService.instance.startForClient(gate.clientId);
    _notifyPortfolioScopeChanged();
    await _saveSession();
    return null;
  }

  /// Returns null if the code is valid for first-login; otherwise an error message.
  Future<String?> tryStartFirstLogin(String c) async {
    final gate = await Get.find<AppRepository>().checkClientLoginAccess(c.trim());
    if (!gate.allowed) return gate.message ?? 'Unknown or blocked login code.';
    if (appSettings.useLiveFirestore && gate.hasPassword == true) {
      return 'Password already set. Enter your password to login.';
    }
    _pendingFirstLoginCode = c.trim();
    return null;
  }

  /// Self-service account creation from the mobile app (when enabled in admin / Firestore config).
  Future<String?> tryCreateAccount({
    required String fullName,
    required String email,
    required String password,
    required String confirmPassword,
    required bool acceptedPrivacy,
    required bool acceptedTerms,
  }) async {
    if (!acceptedPrivacy || !acceptedTerms) {
      return 'You must accept the Privacy Policy and Terms of Service.';
    }
    if (password != confirmPassword) return 'Passwords do not match.';
    if (!Get.isRegistered<MobileConfigController>()) {
      return 'App settings are still loading. Please try again.';
    }
    final mobileConfig = Get.find<MobileConfigController>();
    if (!mobileConfig.allowMobileSignup) {
      return 'Account creation from the app is disabled. Contact your adviser for a login code.';
    }
    final result = await createClientFromMobileSignup(
      fullName: fullName,
      email: email,
      password: password,
    );
    if (!result.success) return result.message ?? 'Could not create account.';
    final clientId = result.clientId;
    final loginCode = result.loginCode;
    if (clientId == null || clientId.isEmpty || loginCode == null || loginCode.isEmpty) {
      return 'Account was created but is incomplete. Contact your adviser.';
    }

    firstLogin.value = false;
    loggedIn.value = true;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kClientPassword, password);
    await prefs.setString(_kClientId, clientId);
    await prefs.setString(_kLoginCode, loginCode);
    this.loginCode.value = loginCode;
    _pushRepoScope(clientId);
    await FcmService.instance.startForClient(clientId);
    _notifyPortfolioScopeChanged();
    await _saveSession();
    return null;
  }

  /// Returns null on success after verifying login code + registered email.
  Future<String?> tryResetPassword({
    required String loginCode,
    required String email,
    required String password,
    required String confirmPassword,
  }) async {
    final pwd = password.trim();
    final confirm = confirmPassword.trim();
    if (pwd != confirm) return 'Passwords do not match.';
    final result = await resetClientPasswordWithVerification(
      loginCode: loginCode.trim(),
      email: email.trim(),
      newPassword: pwd,
    );
    if (!result.success) return result.message ?? 'Could not reset password.';
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kClientPassword, pwd);
    if (result.clientId != null && result.clientId!.isNotEmpty) {
      await prefs.setString(_kClientId, result.clientId!);
    }
    final code = loginCode.trim();
    await prefs.setString(_kLoginCode, code);
    this.loginCode.value = code;
    firstLogin.value = false;
    await prefs.setBool(_kFirstLogin, false);
    return null;
  }

  /// Returns null on success.
  Future<String?> trySetPassword(String p) async {
    final pwd = p.trim();
    if (pwd.length < 8) return 'Password must be at least 8 characters.';
    final gate =
        await Get.find<AppRepository>().checkClientLoginAccess(_pendingFirstLoginCode);
    if (!gate.allowed) {
      return gate.message ?? 'This login code is no longer valid.';
    }
    if (gate.clientId == null || gate.clientId!.isEmpty) {
      return 'Client record is incomplete. Contact your adviser.';
    }
    if (appSettings.useLiveFirestore && gate.hasPassword == true) {
      return 'Password already set. Please login with your password.';
    }
    firstLogin.value = false;
    loggedIn.value = true;
    final code = _pendingFirstLoginCode;
    _pendingFirstLoginCode = '';
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kClientPassword, pwd);
    if (appSettings.useLiveFirestore) {
      await setClientPassword(clientId: gate.clientId!, password: pwd);
    }
    await prefs.setString(_kClientId, gate.clientId!);
    await prefs.setString(_kLoginCode, code);
    loginCode.value = code;
    _pushRepoScope(gate.clientId);
    await FcmService.instance.startForClient(gate.clientId);
    _notifyPortfolioScopeChanged();
    await _saveSession();
    return null;
  }

  Future<void> _saveSession() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_kLoggedIn, loggedIn.value);
    await prefs.setBool(_kFirstLogin, firstLogin.value);
  }

  Future<void> logout() async {
    loggedIn.value = false;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_kLoggedIn, false);
    final cid = prefs.getString(_kClientId);
    await prefs.remove(_kClientId);
    await prefs.remove(_kLoginCode);
    loginCode.value = '';
    await FcmService.instance.stopForClient(cid);
    _pushRepoScope(null);
    _notifyPortfolioScopeChanged();
  }

  Future<String?> deleteAccount() async {
    final prefs = await SharedPreferences.getInstance();
    final cid = prefs.getString(_kClientId);
    final app = Get.find<AppController>();
    final err = await app.deleteClientAccount(cid);
    if (err != null) return err;
    await deleteAccountLocalSession();
    return null;
  }

  Future<void> deleteAccountLocalSession() async {
    loggedIn.value = false;
    firstLogin.value = true;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_kLoggedIn, false);
    await prefs.setBool(_kFirstLogin, true);
    await prefs.remove(_kClientPassword);
    final cid = prefs.getString(_kClientId);
    await prefs.remove(_kClientId);
    await prefs.remove(_kLoginCode);
    loginCode.value = '';
    await FcmService.instance.stopForClient(cid);
    _pushRepoScope(null);
    _notifyPortfolioScopeChanged();
  }
}
